"""Движок дискусії: стан-машина, яка робить один крок за виклик.

Фази: opening → debate (до N раундів) → synthesis → devil → rebuttal → final → done.
Вступ (opening) і відповідь на Devil (rebuttal) виконуються паралельно: один
крок створює повідомлення всіх учасників. Дебати — по одній репліці за крок;
якщо всі учасники в раунді зайняли однакову позицію, решта раундів
пропускається. Кожен AI-учасник викликає власну модель, а модератор і AI Devil
використовують модель першого доступного учасника.

Крок розділений на три частини:
1. атомарний «lease» на дискусії (захист від паралельних advance);
2. LLM-виклик поза транзакцією;
3. атомарне збереження результату з перевіркою lease-токена.

Така схема не тримає транзакцію під час мережевого запиту і не дозволяє двом
запитам одночасно створити повідомлення з однаковим seq.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ..models import Discussion, Message
from ..personas import DEVIL, MODERATOR
from . import prompts
from .catalog import default_model_id, resolve_model
from .providers import ProviderError, get_provider

logger = logging.getLogger(__name__)

MAX_SEQ_STEP = 1
DEFAULT_TEMPERATURE = 0.7
JSON_TEMPERATURE = 0.2
MAX_ERROR_DETAIL = 4000
MAX_PARALLEL_CALLS = 5
STANCE_AGREE = 'згода'
STANCE_DISPUTE = 'суперечка'

_SERVICE_LINE_RE = re.compile(
    r'^[ \t>*_#\-]*(ТЕЗА|ПОЗИЦІЯ)[ \t*_]*:[ \t*_]*(.*?)[ \t*_]*$',
    re.IGNORECASE | re.MULTILINE,
)

_JSON_FENCE_RE = re.compile(
    r'```(?:json)?\s*(.*?)\s*```',
    re.IGNORECASE | re.DOTALL,
)


class EngineError(Exception):
    """Помилка, яку можна показати користувачу без технічних деталей."""

    def __init__(self, message, *, detail='', code='engine_error'):
        super().__init__(message)
        self.detail = detail or message
        self.code = code


class EngineBusy(EngineError):
    """Інший запит уже виконує крок цієї дискусії."""


class EngineConflict(EngineError):
    """Стан дискусії змінився, поки виконувався LLM-виклик."""


@dataclass
class StepPlan:
    phase: str
    role: str
    persona: dict
    model_id: str
    system: str
    prompt: str
    temperature: float
    reply_to: str = ''
    reply_to_slug: str = ''
    debate_round: int | None = None
    json_kind: str | None = None


def _strip_code_fences(raw):
    text = str(raw or '').strip()
    matches = _JSON_FENCE_RE.findall(text)
    if matches:
        return matches[0].strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE)
        text = re.sub(r'\s*```$', '', text)
    return text.strip()


def _extract_json(raw):
    """Витягує перший JSON-об'єкт навіть із тексту навколо нього."""
    if not isinstance(raw, str) or not raw.strip():
        return None

    candidates = [raw.strip(), _strip_code_fences(raw)]
    decoder = json.JSONDecoder()
    for candidate in candidates:
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass

        for index, char in enumerate(candidate):
            if char != '{':
                continue
            try:
                data, _ = decoder.raw_decode(candidate[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(data, dict):
                return data
    return None


def parse_json(raw, fallback=None):
    """Сумісний із попереднім API парсер: повертає dict або fallback."""
    return _extract_json(raw) or fallback


def _text(value, default='', limit=4000):
    if value is None:
        return default
    if isinstance(value, bool):
        return default
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    text = str(value).strip()
    return text[:limit] if text else default


def _text_list(value, *, limit=8, item_limit=1200):
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        return []
    result = []
    for item in value:
        text = _text(item, limit=item_limit)
        if text and text not in result:
            result.append(text)
        if len(result) >= limit:
            break
    return result


def _answer(value, mode, options):
    if value is None:
        return None
    text = _text(value, limit=200)
    if not text:
        return None
    if mode == Discussion.Mode.YES_NO:
        normalized = text.casefold().strip(' .,!?:;')
        if normalized in {'так', 'yes', 'true', 'позитивно', 'згоден', 'згодна'}:
            return 'так'
        if normalized in {'ні', 'no', 'false', 'негативно', 'не згоден', 'не згодна'}:
            return 'ні'
        return None
    if mode == Discussion.Mode.CHOOSE_ONE:
        folded = text.casefold()
        for option in options or []:
            if folded == str(option).casefold():
                return str(option)
        return None
    return text


def _as_bool(value, default=True):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in {0, 1}:
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().casefold()
        if normalized in {'true', '1', 'yes', 'так', 'підтверджено'}:
            return True
        if normalized in {'false', '0', 'no', 'ні', 'не підтверджено'}:
            return False
    return default


def _confidence(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return max(0, min(100, number))


def normalize_solution(data, mode, options, raw=''):
    data = data if isinstance(data, dict) else {}
    result = {
        'decision': _text(data.get('decision'), 'Рішення не сформовано', limit=2000),
        'reasoning': _text(data.get('reasoning'), limit=4000),
        'supporting_arguments': _text_list(data.get('supporting_arguments')),
        'dissenting_points': _text_list(data.get('dissenting_points')),
    }
    answer = _answer(data.get('answer'), mode, options)
    if answer:
        result['answer'] = answer
    if not result['reasoning'] and raw:
        result['reasoning'] = _text(raw, limit=500)
    return result


def normalize_review(data, raw=''):
    data = data if isinstance(data, dict) else {}
    risks = []
    for item in data.get('risks') or []:
        if isinstance(item, dict):
            title = _text(item.get('title'), limit=300)
            description = _text(item.get('description'), limit=1000)
            severity = _text(item.get('severity'), limit=40)
            if title or description:
                risks.append(
                    {
                        'title': title or description,
                        'description': description,
                        'severity': severity,
                    }
                )
        else:
            text = _text(item, limit=1000)
            if text:
                risks.append({'title': text, 'description': '', 'severity': ''})
        if len(risks) >= 8:
            break
    return {
        'verdict': _text(data.get('verdict'), raw[:300] if raw else 'Не вдалося отримати відповідь AI Devil'),
        'risks': risks,
        'weak_spots': _text_list(data.get('weak_spots')),
        'counter_arguments': _text_list(data.get('counter_arguments')),
    }


def normalize_summary(data, best_solution, mode, options, raw=''):
    data = data if isinstance(data, dict) else {}
    fallback_decision = (best_solution or {}).get('decision', '')
    result = {
        'decision': _text(data.get('decision'), fallback_decision, limit=2000),
        'confirmed': _as_bool(data.get('confirmed'), False),
        'revision': _text(data.get('revision'), limit=2000),
        'pros': _text_list(data.get('pros')),
        'cons': _text_list(data.get('cons')),
        'risks': _text_list(data.get('risks')),
        'confidence': _confidence(data.get('confidence')),
        'recommendation': _text(data.get('recommendation'), raw[:500] if raw else '', limit=2000),
    }
    answer = _answer(data.get('answer'), mode, options)
    if answer:
        result['answer'] = answer
    return result


def _valid_solution(data):
    return isinstance(data, dict) and bool(_text(data.get('decision')))


def _valid_review(data):
    return isinstance(data, dict) and bool(
        _text(data.get('verdict')) or data.get('risks')
    )


def _valid_summary(data):
    return isinstance(data, dict) and bool(_text(data.get('decision')))


def _next_seq(discussion):
    last = discussion.messages.order_by('-seq').values_list('seq', flat=True).first()
    return (last or 0) + MAX_SEQ_STEP


def _add_message(
    discussion,
    *,
    persona,
    role,
    phase,
    content,
    debate_round=None,
    reply_to='',
    reply_to_slug='',
    thesis='',
    stance='',
):
    return Message.objects.create(
        discussion=discussion,
        seq=_next_seq(discussion),
        phase=phase,
        round=debate_round,
        role=role,
        persona_slug=persona['slug'],
        persona_name=persona['name'],
        avatar=persona['avatar'],
        color=persona.get('color', ''),
        content=content,
        reply_to=reply_to,
        reply_to_slug=reply_to_slug,
        thesis=thesis,
        stance=stance,
    )


def _list_messages(discussion):
    return list(discussion.messages.order_by('seq'))


def _normalize_stance(value, mode, options):
    text = _text(value, limit=200).strip(' .,!?:;«»"\'')
    if not text:
        return ''
    if mode == Discussion.Mode.YES_NO:
        words = text.split()
        return _answer(words[0], mode, options) or _answer(text, mode, options) or ''
    if mode == Discussion.Mode.CHOOSE_ONE:
        exact = _answer(text, mode, options)
        if exact:
            return exact
        folded = text.casefold()
        matches = sorted(
            (str(option) for option in options or [] if str(option).casefold() in folded),
            key=len,
            reverse=True,
        )
        # «Так» і «Так, але пізніше» — вкладені варіанти, беремо довший;
        # два різні варіанти в одній позиції — неоднозначність.
        if matches and all(item.casefold() in matches[0].casefold() for item in matches):
            return matches[0]
        return ''
    folded = text.casefold()
    if folded.startswith(('незгод', 'не згод', 'супереч')):
        return STANCE_DISPUTE
    if folded.startswith('згод'):
        return STANCE_AGREE
    return ''


def parse_reply(raw, mode, options):
    """Відокремлює службові рядки ТЕЗА/ПОЗИЦІЯ від тексту репліки."""
    text = str(raw or '').replace('\r\n', '\n')
    thesis = ''
    stance = ''
    for match in _SERVICE_LINE_RE.finditer(text):
        key = match.group(1).casefold()
        value = match.group(2)
        if key == 'теза':
            thesis = thesis or _text(value, limit=300)
        else:
            stance = stance or _normalize_stance(value, mode, options)
    content = _SERVICE_LINE_RE.sub('', text)
    content = re.sub(r'\n{3,}', '\n\n', content).strip() or text.strip()
    if not thesis:
        thesis = prompts.fallback_thesis(content)
    return content, thesis[:300], stance[:100]


def _reply_target(messages, persona):
    """Обирає, кому відповідає учасник у раунді дебатів.

    Пріоритет: незакрите звернення до мовця → не той самий співрозмовник, що
    минулого разу → учасник з іншою позицією → той, кому мовець ще не
    відповідав → найсвіжіша репліка. Повертає (Message | None, причина).
    """
    slug = persona['slug']
    ai = [
        message
        for message in messages
        if message.role == Message.Role.AI
        and message.phase in {Discussion.Phase.OPENING, Discussion.Phase.DEBATE}
    ]
    mine = [message for message in ai if message.persona_slug == slug]
    my_last_seq = mine[-1].seq if mine else 0
    my_last_target = mine[-1].reply_to_slug if mine else ''
    my_stance = next((message.stance for message in reversed(mine) if message.stance), '')
    replied = {message.reply_to_slug for message in mine if message.reply_to_slug}

    latest = {}
    for message in ai:
        if message.persona_slug != slug:
            latest[message.persona_slug] = message

    best = (None, '')
    best_key = None
    for other_slug, message in latest.items():
        addressed = next(
            (
                item
                for item in reversed(ai)
                if item.persona_slug == other_slug
                and item.reply_to_slug == slug
                and item.seq > my_last_seq
            ),
            None,
        )
        disagree = bool(my_stance and message.stance and message.stance != my_stance)
        key = (
            addressed is not None,
            other_slug != my_last_target,
            disagree,
            other_slug not in replied,
            message.seq,
        )
        if best_key is None or key > best_key:
            best_key = key
            if addressed is not None:
                best = (addressed, 'question')
            else:
                best = (message, 'disagree' if disagree else 'new')
    return best


def _default_model():
    return default_model_id() or settings.LLM_DEFAULT_MODEL


def _is_available(model_id):
    if not model_id:
        return False
    spec = resolve_model(model_id)
    return bool(spec and spec.get('available'))


def _moderator_model(personas):
    candidates = []
    for persona in personas:
        model_id = persona.get('model')
        if model_id and model_id not in candidates:
            candidates.append(model_id)
    for model_id in (_default_model(), settings.LLM_DEFAULT_MODEL):
        if model_id and model_id not in candidates:
            candidates.append(model_id)
    for model_id in candidates:
        if _is_available(model_id):
            return model_id
    return candidates[0] if candidates else _default_model()


def _resolved_personas(discussion):
    """Повертає персон з усіма user-оверайдами: name, style, traits, model."""
    from ..personas import PERSONA_BY_SLUG

    resolved = []
    for item in discussion.personas:
        if isinstance(item, dict):
            slug = item.get('slug', '')
        else:
            slug = str(item)
        base = PERSONA_BY_SLUG.get(slug)
        if base is None:
            continue
        persona = dict(base)
        persona['model'] = _default_model()
        persona['traits'] = []
        persona['temperature'] = DEFAULT_TEMPERATURE
        if isinstance(item, dict):
            if item.get('name'):
                persona['name'] = _text(item['name'], limit=64)
            if item.get('style'):
                persona['custom_style'] = _text(item['style'], limit=300)
            if item.get('traits'):
                persona['traits'] = _text_list(
                    item['traits'], limit=20, item_limit=40
                )
            if item.get('model'):
                persona['model'] = _text(item['model'], limit=120)
            if item.get('temperature') is not None:
                try:
                    value = float(item['temperature'])
                except (TypeError, ValueError):
                    value = DEFAULT_TEMPERATURE
                persona['temperature'] = max(0.0, min(1.0, value))
        resolved.append(persona)
    return resolved


def _model_for_persona(persona):
    return persona.get('model') or _default_model()


def _mode_ctx(discussion):
    return discussion.mode, list(discussion.options or [])


def _json_repair_prompt(plan, raw):
    return (
        f'{plan.prompt}\n\n'
        'ВАЖЛИВО: попередня відповідь була невалідною або неповною. '
        'Поверни ЛИШЕ один валідний JSON-об’єкт без markdown, коментарів '
        'і тексту до/після нього. Ось попередня відповідь для виправлення:\n'
        f'{str(raw)[:4000]}'
    )


def _complete(
    provider_factory,
    model_id,
    system,
    prompt,
    temperature=DEFAULT_TEMPERATURE,
    json_mode=False,
):
    started = time.monotonic()
    kwargs = {'json_mode': True} if json_mode else {}
    try:
        provider = provider_factory(model_id) if provider_factory else get_provider(model_id)
        text = provider.complete(
            system=system,
            prompt=prompt,
            temperature=temperature,
            **kwargs,
        )
    except ProviderError as exc:
        logger.warning(
            'LLM provider error',
            extra={'model': model_id, 'error': str(exc)},
        )
        raise EngineError(
            'Модель не змогла відповісти. Спробуйте ще раз.',
            detail=f'{model_id}: {exc}',
            code='provider_error',
        ) from exc
    except Exception as exc:
        logger.exception('Unexpected LLM provider failure', extra={'model': model_id})
        raise EngineError(
            'Під час звернення до моделі сталася помилка. Спробуйте ще раз.',
            detail=f'{model_id}: {type(exc).__name__}: {exc}',
            code='provider_error',
        ) from exc

    if not isinstance(text, str) or not text.strip():
        raise EngineError(
            'Модель повернула порожню відповідь. Спробуйте ще раз.',
            detail=f'{model_id}: empty completion',
            code='empty_response',
        )

    logger.info(
        'LLM completion finished',
        extra={'model': model_id, 'seconds': round(time.monotonic() - started, 2)},
    )
    return text.strip()


def _complete_json(provider_factory, plan):
    raw = _complete(
        provider_factory,
        plan.model_id,
        plan.system,
        plan.prompt,
        plan.temperature,
        json_mode=True,
    )
    data = _extract_json(raw)
    validators = {
        'solution': _valid_solution,
        'review': _valid_review,
        'summary': _valid_summary,
    }
    validator = validators[plan.json_kind]
    if not validator(data):
        logger.warning(
            'Invalid JSON completion, requesting repair',
            extra={'model': plan.model_id, 'kind': plan.json_kind},
        )
        repaired = _complete(
            provider_factory,
            plan.model_id,
            plan.system,
            _json_repair_prompt(plan, raw),
            JSON_TEMPERATURE,
            json_mode=True,
        )
        data = _extract_json(repaired) or data
    return raw, data or {}


def _speakers_done(messages, phase):
    return {
        message.persona_slug
        for message in messages
        if message.role == Message.Role.AI and message.phase == phase
    }


def _persona_plan(persona, phase, prompt, **extra):
    return StepPlan(
        phase=phase,
        role=Message.Role.AI,
        persona=persona,
        model_id=_model_for_persona(persona),
        system=prompts.persona_system(persona),
        prompt=prompt,
        temperature=persona.get('temperature', DEFAULT_TEMPERATURE),
        **extra,
    )


def _prepare_step(discussion):
    """Будує LLM-виклики для поточного кроку.

    Вступ і відповідь на Devil — паралельні кроки: по виклику на кожного
    учасника, який ще не висловився в цій фазі. Решта фаз — один виклик.
    """
    personas = _resolved_personas(discussion)
    if not personas:
        raise EngineError('У дискусії немає AI-учасників.', code='no_personas')
    messages = _list_messages(discussion)
    mode, options = _mode_ctx(discussion)
    phase = discussion.phase
    common = {'mode': mode, 'options': options, 'rounds': discussion.rounds}

    if phase == Discussion.Phase.OPENING:
        done = _speakers_done(messages, phase)
        return [
            _persona_plan(
                persona,
                phase,
                prompts.opening_prompt(discussion.question, persona, personas, **common),
            )
            for persona in personas
            if persona['slug'] not in done
        ]

    if phase == Discussion.Phase.DEBATE:
        if discussion.speaker_index >= len(personas):
            raise EngineError('Некоректний індекс учасника дискусії.', code='bad_state')
        persona = personas[discussion.speaker_index]
        target, reason = _reply_target(messages, persona)
        reply_to = target.persona_name if target else ''
        return [
            _persona_plan(
                persona,
                phase,
                prompts.debate_prompt(
                    discussion.question,
                    persona,
                    personas,
                    messages,
                    discussion.current_round,
                    reply_to=reply_to,
                    reply_reason=reason,
                    **common,
                ),
                debate_round=discussion.current_round,
                reply_to=reply_to,
                reply_to_slug=target.persona_slug if target else '',
            )
        ]

    if phase == Discussion.Phase.REBUTTAL:
        done = _speakers_done(messages, phase)
        return [
            _persona_plan(
                persona,
                phase,
                prompts.rebuttal_prompt(
                    discussion.question, persona, personas, messages, **common
                ),
                reply_to=DEVIL['name'],
                reply_to_slug=DEVIL['slug'],
            )
            for persona in personas
            if persona['slug'] not in done
        ]

    if phase == Discussion.Phase.SYNTHESIS:
        return [
            StepPlan(
                phase=phase,
                role=Message.Role.MODERATOR,
                persona=MODERATOR,
                model_id=_moderator_model(personas),
                system=prompts.MODERATOR_SYSTEM,
                prompt=prompts.synthesis_prompt(
                    discussion.question,
                    personas,
                    messages,
                    early_stop=discussion.early_stop,
                    **common,
                ),
                temperature=JSON_TEMPERATURE,
                json_kind='solution',
            )
        ]

    if phase == Discussion.Phase.DEVIL:
        return [
            StepPlan(
                phase=phase,
                role=Message.Role.DEVIL,
                persona=DEVIL,
                model_id=_moderator_model(personas),
                system=prompts.DEVIL_SYSTEM,
                prompt=prompts.devil_prompt(
                    discussion.question,
                    personas,
                    discussion.best_solution or {},
                    messages,
                    **common,
                ),
                temperature=JSON_TEMPERATURE,
                json_kind='review',
            )
        ]

    if phase == Discussion.Phase.FINAL:
        return [
            StepPlan(
                phase=phase,
                role=Message.Role.MODERATOR,
                persona=MODERATOR,
                model_id=_moderator_model(personas),
                system=prompts.MODERATOR_SYSTEM,
                prompt=prompts.final_prompt(
                    discussion.question,
                    personas,
                    discussion.best_solution or {},
                    discussion.devil_review or {},
                    messages,
                    **common,
                ),
                temperature=JSON_TEMPERATURE,
                json_kind='summary',
            )
        ]

    raise EngineError(f'Невідома фаза: {discussion.phase}', code='bad_state')


def _run_plan(plan, provider_factory, discussion):
    mode, options = _mode_ctx(discussion)
    if plan.json_kind is None:
        raw = _complete(
            provider_factory,
            plan.model_id,
            plan.system,
            plan.prompt,
            plan.temperature,
        )
        return parse_reply(raw, mode, options)

    raw, data = _complete_json(provider_factory, plan)
    if plan.json_kind == 'solution':
        return normalize_solution(data, mode, options, raw=raw)
    if plan.json_kind == 'review':
        return normalize_review(data, raw=raw)
    return normalize_summary(
        data, discussion.best_solution or {}, mode, options, raw=raw
    )


def _run_plans(plans, provider_factory, discussion):
    """Виконує виклики (паралельно, якщо їх кілька). Повертає [(plan, payload, error)]."""
    if len(plans) == 1:
        plan = plans[0]
        return [(plan, _run_plan(plan, provider_factory, discussion), None)]

    results = []
    workers = max(1, min(len(plans), MAX_PARALLEL_CALLS))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(_run_plan, plan, provider_factory, discussion) for plan in plans
        ]
        for plan, future in zip(plans, futures):
            try:
                results.append((plan, future.result(), None))
            except EngineError as exc:
                results.append((plan, None, exc))
            except Exception as exc:
                logger.exception('Unexpected parallel step failure')
                results.append(
                    (
                        plan,
                        None,
                        EngineError(
                            'Не вдалося отримати відповідь учасника.',
                            detail=f'{type(exc).__name__}: {exc}',
                            code='internal_error',
                        ),
                    )
                )
    return results


def _join_items(items):
    """Склеює пункти в одне речення без подвійних розділових знаків."""
    return '; '.join(item.rstrip(' .;') for item in items if item.rstrip(' .;'))


def _moderator_text(best_solution):
    best_solution = best_solution if isinstance(best_solution, dict) else {}
    decision = _text(best_solution.get('decision'), 'рішення не визначено', limit=2000)
    reasoning = _text(best_solution.get('reasoning'), limit=4000)
    args = _join_items(_text_list(best_solution.get('supporting_arguments'), limit=4))
    paragraphs = []
    answer = _text(best_solution.get('answer'), limit=200)
    if answer:
        paragraphs.append(f'Відповідь: {answer}')
    paragraphs.append(f'Пропоноване рішення: {decision}')
    if reasoning:
        paragraphs.append(reasoning)
    if args:
        paragraphs.append(f'Аргументи на користь рішення: {args}.')
    return '\n\n'.join(paragraphs).strip()


def _devil_text(review):
    review = review if isinstance(review, dict) else {}
    paragraphs = []
    verdict = _text(review.get('verdict'), limit=1000)
    if verdict:
        paragraphs.append(verdict)

    for risk in review.get('risks') or []:
        if not isinstance(risk, dict):
            continue
        title = _text(risk.get('title'), limit=300)
        description = _text(risk.get('description'), limit=1000)
        severity = _text(risk.get('severity'), limit=40)
        details = ' — '.join(
            part.rstrip(' .;') for part in (title, description) if part
        )
        if details:
            suffix = f' (ризик: {severity})' if severity else ''
            paragraphs.append(f'{details}{suffix}.')

    weak_spots = _text_list(review.get('weak_spots'), limit=3)
    if weak_spots:
        paragraphs.append(f'Слабкі місця: {_join_items(weak_spots)}.')

    counter_arguments = _text_list(review.get('counter_arguments'), limit=3)
    if counter_arguments:
        paragraphs.append(f'Контраргументи: {_join_items(counter_arguments)}.')

    return '\n\n'.join(paragraphs).strip() or 'AI Devil не знайшов додаткових ризиків.'


def _final_text(summary):
    summary = summary if isinstance(summary, dict) else {}
    paragraphs = []
    answer = _text(summary.get('answer'), limit=200)
    if answer:
        paragraphs.append(f'Відповідь: {answer}')

    decision = _text(summary.get('decision'), 'рішення не визначено', limit=2000)
    paragraphs.append(f'Фінальне рішення: {decision}')

    if summary.get('confirmed') is False:
        revision = _text(summary.get('revision'), limit=2000)
        text = 'Висновок переглянуто після перевірки AI Devil.'
        if revision:
            text = f'{text} Що змінилось: {revision}'
        paragraphs.append(text)
    else:
        paragraphs.append('Висновок підтверджено після перевірки AI Devil.')

    confidence = summary.get('confidence')
    if confidence is None:
        paragraphs.append('Впевненість: не визначено.')
    else:
        paragraphs.append(f'Впевненість: {confidence}%.')

    recommendation = _text(summary.get('recommendation'), limit=2000)
    if recommendation:
        paragraphs.append(f'Що робити далі: {recommendation}')
    return '\n\n'.join(paragraphs).strip()


def _claim(discussion_id, token):
    """Атомарно резервує крок. Повертає свіжий Discussion або None для done."""
    now = timezone.now()
    with transaction.atomic():
        discussion = (
            Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        )
        if discussion is None:
            raise EngineError('Дискусію не знайдено.', code='not_found')
        if discussion.phase == Discussion.Phase.DONE:
            return None
        if discussion.advance_token:
            started = discussion.advance_started_at or now
            lease_until = started + timedelta(seconds=settings.LLM_ADVANCE_LEASE_SECONDS)
            if lease_until > now:
                raise EngineBusy(
                    'Дискусія вже обробляється. Зачекайте кілька секунд.',
                    code='busy',
                )
        discussion.advance_token = token
        discussion.advance_started_at = now
        discussion.advance_count = (discussion.advance_count or 0) + 1
        if discussion.status in {Discussion.Status.NEW, Discussion.Status.FAILED}:
            discussion.status = Discussion.Status.IN_PROGRESS
            discussion.error = ''
        discussion.save(
            update_fields=[
                'advance_token',
                'advance_started_at',
                'advance_count',
                'status',
                'error',
                'updated_at',
            ]
        )
        return discussion


def _fail(discussion_id, token, detail):
    """Позначає крок failed, але лише якщо lease все ще належить цьому запиту."""
    with transaction.atomic():
        discussion = (
            Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        )
        if discussion is None or discussion.advance_token != token:
            return
        discussion.status = Discussion.Status.FAILED
        discussion.error = str(detail or '')[:MAX_ERROR_DETAIL]
        discussion.advance_token = None
        discussion.advance_started_at = None
        discussion.save(
            update_fields=[
                'status',
                'error',
                'advance_token',
                'advance_started_at',
                'updated_at',
            ]
        )


def _round_consensus(discussion, personas):
    """Усі учасники в щойно завершеному раунді мають однакову позицію."""
    stances = dict(
        Message.objects.filter(
            discussion=discussion,
            phase=Discussion.Phase.DEBATE,
            round=discussion.current_round,
            role=Message.Role.AI,
        )
        .order_by('seq')
        .values_list('persona_slug', 'stance')
    )
    values = [stances.get(persona['slug'], '') for persona in personas]
    if not values or not all(values):
        return False
    if discussion.mode == Discussion.Mode.OPEN:
        return all(value == STANCE_AGREE for value in values)
    return len(set(values)) == 1


def _next_speaker_transition(discussion, personas):
    next_index = discussion.speaker_index + 1
    if next_index < len(personas):
        discussion.speaker_index = next_index
        return
    discussion.speaker_index = 0
    if discussion.current_round < discussion.rounds and not _round_consensus(
        discussion, personas
    ):
        discussion.current_round += 1
        return
    discussion.early_stop = discussion.current_round < discussion.rounds
    discussion.phase = Discussion.Phase.SYNTHESIS


def _all_spoke(discussion, personas, phase):
    done = set(
        Message.objects.filter(
            discussion=discussion, phase=phase, role=Message.Role.AI
        ).values_list('persona_slug', flat=True)
    )
    return all(persona['slug'] in done for persona in personas)


def _store(discussion, plan, payload):
    if plan.role == Message.Role.AI:
        content, thesis, stance = payload
        return _add_message(
            discussion,
            persona=plan.persona,
            role=Message.Role.AI,
            phase=plan.phase,
            content=content,
            debate_round=plan.debate_round,
            reply_to=plan.reply_to,
            reply_to_slug=plan.reply_to_slug,
            thesis=thesis,
            stance=stance,
        )
    if plan.phase == Discussion.Phase.SYNTHESIS:
        discussion.best_solution = payload
        content = _moderator_text(payload)
    elif plan.phase == Discussion.Phase.DEVIL:
        discussion.devil_review = payload
        content = _devil_text(payload)
    elif plan.phase == Discussion.Phase.FINAL:
        discussion.final_summary = payload
        content = _final_text(payload)
    else:
        raise EngineError(f'Невідома фаза: {plan.phase}', code='bad_state')
    return _add_message(
        discussion,
        persona=plan.persona,
        role=plan.role,
        phase=plan.phase,
        content=content,
    )


def _transition(discussion, personas):
    phase = discussion.phase
    if phase == Discussion.Phase.OPENING:
        if _all_spoke(discussion, personas, phase):
            discussion.phase = Discussion.Phase.DEBATE
            discussion.current_round = 1
            discussion.speaker_index = 0
    elif phase == Discussion.Phase.DEBATE:
        _next_speaker_transition(discussion, personas)
    elif phase == Discussion.Phase.SYNTHESIS:
        discussion.phase = Discussion.Phase.DEVIL
    elif phase == Discussion.Phase.DEVIL:
        discussion.phase = Discussion.Phase.REBUTTAL
    elif phase == Discussion.Phase.REBUTTAL:
        if _all_spoke(discussion, personas, phase):
            discussion.phase = Discussion.Phase.FINAL
    elif phase == Discussion.Phase.FINAL:
        discussion.phase = Discussion.Phase.DONE
        discussion.status = Discussion.Status.DONE
        discussion.finished_at = timezone.now()
    else:
        raise EngineError(f'Невідома фаза: {phase}', code='bad_state')


def _commit(discussion_id, token, phase, results, error_detail=''):
    """Зберігає результати кроку. Якщо частина паралельних викликів упала,
    зберігає вдалі відповіді й позначає дискусію failed без переходу фази."""
    with transaction.atomic():
        discussion = (
            Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        )
        if discussion is None:
            raise EngineError('Дискусію не знайдено.', code='not_found')
        if discussion.advance_token != token:
            raise EngineConflict(
                'Дискусію вже оновив інший запит.',
                code='conflict',
            )
        if discussion.phase != phase:
            raise EngineConflict(
                'Стан дискусії змінився. Оновіть її.',
                code='conflict',
            )

        personas = _resolved_personas(discussion)
        created = [_store(discussion, plan, payload) for plan, payload in results]
        if error_detail:
            discussion.status = Discussion.Status.FAILED
            discussion.error = error_detail[:MAX_ERROR_DETAIL]
        else:
            _transition(discussion, personas)
            discussion.error = ''

        discussion.advance_token = None
        discussion.advance_started_at = None
        discussion.save()
        return created


def advance(discussion, provider_factory=None):
    """Робить один крок дискусії.

    Повертає список створених повідомлень: одне для звичайного кроку, кілька
    для паралельних фаз, порожній — якщо дискусію вже завершено.
    """
    if discussion is None or not getattr(discussion, 'pk', None):
        raise EngineError('Дискусію не знайдено.', code='not_found')

    discussion_id = discussion.pk
    token = uuid.uuid4()
    claimed = _claim(discussion_id, token)
    if claimed is None:
        return []

    try:
        plans = _prepare_step(claimed)
        results = _run_plans(plans, provider_factory, claimed) if plans else []
        succeeded = [(plan, payload) for plan, payload, error in results if error is None]
        errors = [error for _, _, error in results if error is not None]
        if errors and not succeeded:
            raise errors[0]
        detail = '; '.join(error.detail for error in errors)
        created = _commit(discussion_id, token, claimed.phase, succeeded, detail)
        if errors:
            raise EngineError(str(errors[0]), detail=detail, code=errors[0].code)
        return created

    except EngineBusy:
        raise
    except EngineConflict:
        raise
    except EngineError as exc:
        _fail(discussion_id, token, exc.detail)
        raise
    except Exception as exc:
        logger.exception('Unexpected engine failure', extra={'discussion': str(discussion_id)})
        _fail(
            discussion_id,
            token,
            f'{type(exc).__name__}: {exc}',
        )
        raise EngineError(
            'Не вдалося продовжити дискусію через внутрішню помилку.',
            detail=f'{type(exc).__name__}: {exc}',
            code='internal_error',
        ) from exc
