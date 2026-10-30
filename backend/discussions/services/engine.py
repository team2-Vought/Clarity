"""Движок дискусії: стан-машина, яка робить один крок за виклик.

Фази: clarify → opening → debate (до N раундів) → synthesis → devil → rebuttal
→ final → done.

Вступ (opening) і відповідь на Devil (rebuttal) виконуються паралельно: один
крок створює повідомлення всіх учасників. Дебати — по одній репліці за крок;
порядок виступів ротується щораунду, щоб ніхто не мав постійного «останнього
слова». Якщо учасники два раунди поспіль займають однакову позицію, решта
раундів пропускається.

Кожен AI-учасник викликає власну модель. Модератор і AI Devil — окремі
«судді»: користувач може задати їм моделі явно, інакше обирається модель, що
не належить жодному учаснику (і для Devil — відмінна від моделі модератора).
Якщо модель судді не відповідає, крок повторюється на наступній доступній.

Нова дискусія починається з перевірки контексту: модератор вирішує, чи досить
деталей. Якщо так — той самий крок одразу переходить до вступу; якщо ні —
дискусія чекає відповідей користувача на його питання (раннер зупиняється).

Якщо увімкнено пошук в інтернеті, моделі шукають лише тоді, коли їм бракує
фактів: учасники додають службовий рядок ПОШУК, а Devil — поле search_queries.
Окремого обов’язкового кроку пошуку перед дискусією немає.

Крок розділений на три частини:
1. атомарний «lease» на дискусії (захист від паралельних advance), який
   продовжує heartbeat-потік, доки триває крок;
2. LLM-виклики та пошук поза транзакцією;
3. атомарне збереження результату з перевіркою lease-токена.
"""

from __future__ import annotations

import contextvars
import json
import logging
import re
import threading
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

from backend.i18n import L, using

from ..models import Discussion, Message
from ..personas import devil, localize, moderator
from . import prompts, search, usage
from .catalog import available_model_ids, default_model_id, model_label, resolve_model
from .providers import ProviderError, get_provider

logger = logging.getLogger(__name__)

MAX_SEQ_STEP = 1
DEFAULT_TEMPERATURE = 0.7
JSON_TEMPERATURE = 0.2
MAX_ERROR_DETAIL = 4000
MAX_ERROR_PUBLIC = 300
MAX_PARALLEL_CALLS = 5
MAX_DEVIL_QUERIES = 2
STANCE_AGREE = 'згода'
STANCE_DISPUTE = 'суперечка'
USER_SLUG = 'user'


def generic_public_error():
    return L(
        'Не вдалося отримати відповідь від AI. Спробуйте ще раз.',
        'Could not get a response from the AI. Please try again.',
    )


# англійські промпти просять THESIS/STANCE/SEARCH — розбираємо обидва варіанти
_SERVICE_LINE_RE = re.compile(
    r'^[ \t>*_#\-]*(ТЕЗА|ПОЗИЦІЯ|ПОШУК|THESIS|STANCE|SEARCH)[ \t*_]*:[ \t*_]*(.*?)[ \t*_]*$',
    re.IGNORECASE | re.MULTILINE,
)
_SERVICE_KEYS = {'thesis': 'теза', 'stance': 'позиція', 'search': 'пошук'}

_JSON_FENCE_RE = re.compile(
    r'```(?:json)?\s*(.*?)\s*```',
    re.IGNORECASE | re.DOTALL,
)


class EngineError(Exception):
    """Помилка кроку.

    `public` — текст, який безпечно показати користувачу (без сирих відповідей
    провайдера); `retryable=False` — повтор без змін (моделі, ключа) не допоможе.
    """

    def __init__(self, message, *, detail='', code='engine_error', public='', retryable=True):
        super().__init__(message)
        self.detail = detail or message
        self.code = code
        self.public = (public or '')[:MAX_ERROR_PUBLIC]
        self.retryable = retryable


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
    fallback_models: list = field(default_factory=list)
    can_search: bool = False
    # модель, яка справді відповіла (судді можуть перейти на запасну)
    used_model: str = ''


# ---------------------------------------------------------------------------
# Розбір і нормалізація відповідей моделей
# ---------------------------------------------------------------------------


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
        # модель може виділити відповідь **жирним**, хоча її просили без розмітки
        normalized = text.casefold().strip(' .,!?:;«»"\'*_')
        if normalized in {'так', 'yes', 'true', 'позитивно', 'згоден', 'згодна'}:
            return 'так'
        if normalized in {'ні', 'no', 'false', 'негативно', 'не згоден', 'не згодна'}:
            return 'ні'
        return None
    if mode == Discussion.Mode.CHOOSE_ONE:
        folded = text.casefold().strip(' .,!?:;«»"\'*_')
        for option in options or []:
            if folded == str(option).casefold():
                return str(option)
        return None
    return text


def _as_bool(value, default=None):
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


def _queries(value, limit):
    result = []
    for item in _text_list(value, limit=limit * 2, item_limit=300):
        query = search.normalize_query(item)
        if query and query.casefold() not in {q.casefold() for q in result}:
            result.append(query)
        if len(result) >= limit:
            break
    return result


def _derive_answer(text, mode, options):
    """Відповідь із вільного тексту рішення, якщо модель не заповнила answer."""
    if mode == Discussion.Mode.OPEN or not text:
        return None
    return _answer(text, mode, options) or _normalize_stance(text, mode, options) or None


def normalize_solution(data, mode, options, fallback_answer=''):
    data = data if isinstance(data, dict) else {}
    decision = _text(data.get('decision'), L('Рішення не сформовано', 'No solution was formed'), limit=2000)
    result = {
        'decision': decision,
        'reasoning': _text(data.get('reasoning'), limit=4000),
        'supporting_arguments': _text_list(data.get('supporting_arguments')),
        'dissenting_points': _text_list(data.get('dissenting_points')),
    }
    answer = (
        _answer(data.get('answer'), mode, options)
        or _derive_answer(decision, mode, options)
        or (fallback_answer if mode != Discussion.Mode.OPEN else None)
    )
    if answer:
        result['answer'] = answer
    return result


def normalize_review(data):
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
        'verdict': _text(data.get('verdict'), limit=1000),
        'risks': risks,
        'weak_spots': _text_list(data.get('weak_spots')),
        'counter_arguments': _text_list(data.get('counter_arguments')),
    }


def normalize_summary(data, best_solution, mode, options):
    data = data if isinstance(data, dict) else {}
    best_solution = best_solution if isinstance(best_solution, dict) else {}
    decision = _text(data.get('decision'), best_solution.get('decision', ''), limit=2000)
    result = {
        'decision': decision,
        'confirmed': _as_bool(data.get('confirmed'), None),
        'revision': _text(data.get('revision'), limit=2000),
        'pros': _text_list(data.get('pros')),
        'cons': _text_list(data.get('cons')),
        'risks': _text_list(data.get('risks')),
        'dissenting_points': (
            _text_list(data.get('dissenting_points'))
            or _text_list(best_solution.get('dissenting_points'))
        ),
        'confidence': _confidence(data.get('confidence')),
        'recommendation': _text(data.get('recommendation'), limit=2000),
    }
    best_answer = _answer(best_solution.get('answer'), mode, options)
    answer = (
        _answer(data.get('answer'), mode, options)
        or _derive_answer(decision, mode, options)
        or best_answer
    )
    if answer and mode != Discussion.Mode.OPEN:
        result['answer'] = answer
        if best_answer and answer != best_answer:
            # Відповідь змінилась — це перегляд, навіть якщо модель написала інакше.
            result['confirmed'] = False
            if not result['revision']:
                result['revision'] = L(
                    f'Відповідь змінено з «{best_answer}» на «{answer}» '
                    'після перевірки AI Devil.',
                    f'The answer changed from “{prompts.stance_label(best_answer)}” to '
                    f'“{prompts.stance_label(answer)}” after AI Devil’s review.',
                )
        elif result['confirmed'] is None and best_answer:
            result['confirmed'] = True
    elif answer:
        result['answer'] = answer
    if result['confirmed'] is True:
        result['revision'] = ''
    return result


_EMPHASIS_RE = re.compile(r'\*{1,2}|(?<!\w)_{1,2}|_{1,2}(?!\w)')


def _plain(value, limit):
    """Питання й варіанти показуються як звичайний текст: прибираємо **жирний** і *курсив*."""
    return _text(_EMPHASIS_RE.sub('', str(value or '')), limit=limit)


def normalize_clarify(data):
    """{ready, questions: [{id, question, options}]}; без запитань — готово."""
    data = data if isinstance(data, dict) else {}
    questions = []
    raw = data.get('questions') if isinstance(data.get('questions'), list) else []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = _plain(item.get('question'), 300)
        options = item.get('options') if isinstance(item.get('options'), list) else []
        variants = []
        for option in options:
            option = _plain(option, 100)
            if option and option.casefold() not in {variant.casefold() for variant in variants}:
                variants.append(option)
            if len(variants) >= prompts.CLARIFY_MAX_OPTIONS:
                break
        if text and len(variants) >= 2:
            questions.append({'id': f'q{len(questions) + 1}', 'question': text, 'options': variants})
        if len(questions) >= prompts.CLARIFY_MAX_QUESTIONS:
            break
    ready = _as_bool(data.get('ready'), True) or not questions
    return {'ready': ready, 'questions': [] if ready else questions}


def _answer_problems(data, mode, options):
    if mode == Discussion.Mode.OPEN or _answer(data.get('answer'), mode, options):
        return []
    if mode == Discussion.Mode.YES_NO:
        return [L('поле "answer" має бути рівно "так" або "ні"', 'the "answer" field must be exactly "yes" or "no"')]
    variants = '; '.join(str(option) for option in options or [])
    return [L(
        f'поле "answer" має дослівно збігатися з одним із варіантів: {variants}',
        f'the "answer" field must match one of the options word for word: {variants}',
    )]


def _not_json():
    return L('відповідь не є JSON-об’єктом', 'the reply is not a JSON object')


def _empty_decision():
    return L('поле "decision" порожнє', 'the "decision" field is empty')


def _solution_problems(data, mode, options):
    if not isinstance(data, dict):
        return [_not_json()]
    problems = [] if _text(data.get('decision')) else [_empty_decision()]
    return problems + _answer_problems(data, mode, options)


def _review_problems(data, mode, options):
    if not isinstance(data, dict):
        return [_not_json()]
    if _text(data.get('verdict')) or data.get('risks'):
        return []
    return [L(
        'потрібні поле "verdict" або непорожній список "risks"',
        'a "verdict" field or a non-empty "risks" list is required',
    )]


def _summary_problems(data, mode, options):
    if not isinstance(data, dict):
        return [_not_json()]
    problems = [] if _text(data.get('decision')) else [_empty_decision()]
    if _as_bool(data.get('confirmed'), None) is None:
        problems.append(L('поле "confirmed" має бути true або false', 'the "confirmed" field must be true or false'))
    return problems + _answer_problems(data, mode, options)


def _clarify_problems(data, mode, options):
    if not isinstance(data, dict):
        return [_not_json()]
    ready = _as_bool(data.get('ready'), None)
    if ready is None:
        return [L('поле "ready" має бути true або false', 'the "ready" field must be true or false')]
    if not ready and not normalize_clarify(data)['questions']:
        return [L(
            'при ready: false потрібні запитання з 2+ варіантами відповіді',
            'ready: false requires questions with 2+ answer options',
        )]
    return []


PROBLEM_CHECKS = {
    'clarify': _clarify_problems,
    'solution': _solution_problems,
    'review': _review_problems,
    'summary': _summary_problems,
}


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
    search_query='',
    source_ids=None,
    model_id='',
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
        search_query=search_query[:300],
        source_ids=source_ids or [],
        model_id=model_id[:120],
    )


def _list_messages(discussion):
    return list(discussion.messages.order_by('seq'))


def _normalize_stance(value, mode, options):
    text = _text(value, limit=200).strip(' .,!?:;«»"\'*_')
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
    if folded.startswith(('незгод', 'не згод', 'супереч', 'disagree', 'dispute', 'disput')):
        return STANCE_DISPUTE
    if folded.startswith(('згод', 'agree')):
        return STANCE_AGREE
    return ''


def parse_reply(raw, mode, options):
    """Відокремлює службові рядки ТЕЗА/ПОЗИЦІЯ/ПОШУК від тексту репліки.

    Службові рядки стоять наприкінці, тож для кожного ключа береться останній
    збіг і вирізається лише він: рядок «Позиція: …» усередині тексту
    залишається частиною репліки.
    """
    text = str(raw or '').replace('\r\n', '\n')
    last = {}
    for match in _SERVICE_LINE_RE.finditer(text):
        key = match.group(1).casefold()
        last[_SERVICE_KEYS.get(key, key)] = match
    thesis = _text(last['теза'].group(2), limit=300) if 'теза' in last else ''
    stance = (
        _normalize_stance(last['позиція'].group(2), mode, options)
        if 'позиція' in last
        else ''
    )
    query = search.normalize_query(last['пошук'].group(2)) if 'пошук' in last else ''

    content = text
    for match in sorted(last.values(), key=lambda item: item.start(), reverse=True):
        content = content[: match.start()] + content[match.end():]
    content = re.sub(r'\n{3,}', '\n\n', content).strip() or text.strip()
    if not thesis:
        thesis = prompts.fallback_thesis(content)
    return {
        'content': content,
        'thesis': thesis[:300],
        'stance': stance[:100],
        'search_query': query,
    }


# ---------------------------------------------------------------------------
# Хто говорить і кому відповідає
# ---------------------------------------------------------------------------


def _question_message(messages):
    return next((message for message in messages if message.role == Message.Role.USER), None)


def _user_notes(messages):
    """Уточнення користувача — усі його повідомлення, крім самого запитання."""
    question = _question_message(messages)
    return [
        message
        for message in messages
        if message.role == Message.Role.USER and message is not question
    ]


def _notes_since(messages, seq):
    return [note for note in _user_notes(messages) if note.seq > seq]


def _speaker_order(personas, debate_round):
    """Порядок виступів у раунді: зсув на один щораунду."""
    if not personas:
        return []
    shift = (max(1, debate_round or 1) - 1) % len(personas)
    return personas[shift:] + personas[:shift]


def _reply_target(messages, persona):
    """Обирає, кому відповідає учасник у раунді дебатів.

    Пріоритет: уточнення користувача, на яке ще ніхто не відповів → незакрите
    звернення до мовця → не той самий співрозмовник, що минулого разу →
    учасник з іншою позицією → той, кому мовець ще не відповідав →
    найсвіжіша репліка. Повертає (Message | None, причина).
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

    for note in reversed(_notes_since(messages, my_last_seq)):
        answered = any(
            message.reply_to_slug == USER_SLUG and message.seq > note.seq
            for message in messages
        )
        if not answered:
            return note, 'user'

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


# ---------------------------------------------------------------------------
# Моделі
# ---------------------------------------------------------------------------


def _default_model():
    return default_model_id() or settings.LLM_DEFAULT_MODEL


def _is_available(model_id):
    if not model_id:
        return False
    spec = resolve_model(model_id)
    return bool(spec and spec.get('available'))


def _judge_models(discussion, personas, role):
    """Моделі для модератора чи Devil у порядку спроб.

    Явний вибір користувача → налаштування → модель, якої немає в жодного
    учасника (неупереджений суддя) → найпоширеніша модель учасників → решта
    доступних. Devil уникає моделі модератора, щоб не перевіряти сам себе.
    """
    persona_models = [persona.get('model') for persona in personas if persona.get('model')]
    counts = Counter(persona_models)
    if role == 'devil':
        explicit = [discussion.devil_model, getattr(settings, 'LLM_DEVIL_MODEL', '')]
    else:
        explicit = [discussion.moderator_model, getattr(settings, 'LLM_MODERATOR_MODEL', '')]
    available = available_model_ids()
    neutral = [model_id for model_id in available if model_id not in counts]
    popular = [model_id for model_id, _ in counts.most_common()]

    candidates = []
    for model_id in [*explicit, *neutral, *popular, *available, _default_model()]:
        if model_id and model_id not in candidates and _is_available(model_id):
            candidates.append(model_id)
    if role == 'devil':
        moderator = (_judge_models(discussion, personas, 'moderator') or [''])[0]
        if not (discussion.devil_model or getattr(settings, 'LLM_DEVIL_MODEL', '')):
            candidates.sort(key=lambda model_id: model_id == moderator)
    if not candidates:
        candidates = [model_id for model_id in [*persona_models, _default_model()] if model_id]
    return candidates


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
        persona = dict(localize(base))
        persona['model'] = _default_model()
        persona['traits'] = []
        persona['temperature'] = DEFAULT_TEMPERATURE
        if isinstance(item, dict):
            if item.get('name'):
                persona['name'] = _text(item['name'], limit=64)
            # стиль і температуру API більше не приймає, але старі дискусії
            # їх зберігають — читаємо, щоб уточнення звучали як раніше
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


# ---------------------------------------------------------------------------
# LLM-виклики
# ---------------------------------------------------------------------------


def _json_repair_prompt(plan, raw, problems):
    issues = '; '.join(problems) if problems else L(
        'формат не відповідає схемі', 'the format does not match the schema'
    )
    note = L(
        f'ВАЖЛИВО: попередня відповідь була невалідною або неповною ({issues}). '
        'Поверни ЛИШЕ один валідний JSON-об’єкт за схемою вище, без markdown, '
        'коментарів і тексту до/після нього. Ось попередня відповідь для виправлення:\n',
        f'IMPORTANT: the previous reply was invalid or incomplete ({issues}). '
        'Return ONLY a single valid JSON object following the schema above, with no '
        'markdown, comments or text before/after it. Here is the previous reply to fix:\n',
    )
    return f'{plan.prompt}\n\n{note}{str(raw)[:4000]}'


def _provider_failure(model_id, exc):
    label = model_label(model_id)
    if getattr(exc, 'quota', False):
        return EngineError(
            'Квоту моделі вичерпано.',
            detail=f'{model_id}: {exc}',
            code='provider_quota',
            public=L(
                f'У моделі «{label}» вичерпано квоту або ліміт тарифу. '
                'Оберіть іншу модель або поповніть баланс у провайдера.',
                f'The model “{label}” has run out of quota or hit its plan limit. '
                'Choose another model or top up your balance with the provider.',
            ),
            retryable=False,
        )
    if getattr(exc, 'config', False):
        return EngineError(
            'Модель недоступна.',
            detail=f'{model_id}: {exc}',
            code='provider_config',
            public=L(
                f'Модель «{label}» недоступна (немає або невірний API-ключ, '
                'модель не знайдено). Оберіть іншу модель.',
                f'The model “{label}” is unavailable (missing or invalid API key, '
                'or the model was not found). Choose another model.',
            ),
            retryable=False,
        )
    return EngineError(
        'Модель не змогла відповісти. Спробуйте ще раз.',
        detail=f'{model_id}: {exc}',
        code='provider_error',
        public=L(
            f'Модель «{label}» тимчасово не відповідає. Спробуйте ще раз.',
            f'The model “{label}” is temporarily not responding. Please try again.',
        ),
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
        raise _provider_failure(model_id, exc) from exc
    except Exception as exc:
        logger.exception('Unexpected LLM provider failure', extra={'model': model_id})
        raise EngineError(
            'Під час звернення до моделі сталася помилка. Спробуйте ще раз.',
            detail=f'{model_id}: {type(exc).__name__}: {exc}',
            code='provider_error',
            public=L(
                f'Модель «{model_label(model_id)}» повернула помилку. Спробуйте ще раз.',
                f'The model “{model_label(model_id)}” returned an error. Please try again.',
            ),
        ) from exc

    if not isinstance(text, str) or not text.strip():
        raise EngineError(
            'Модель повернула порожню відповідь. Спробуйте ще раз.',
            detail=f'{model_id}: empty completion',
            code='empty_response',
            public=L(
                f'Модель «{model_label(model_id)}» повернула порожню відповідь.',
                f'The model “{model_label(model_id)}” returned an empty response.',
            ),
        )

    logger.info(
        'LLM completion finished',
        extra={'model': model_id, 'seconds': round(time.monotonic() - started, 2)},
    )
    return text.strip()


def _complete_json(provider_factory, plan, model_id, mode, options):
    check = PROBLEM_CHECKS[plan.json_kind]
    raw = _complete(
        provider_factory, model_id, plan.system, plan.prompt, plan.temperature, json_mode=True
    )
    data = _extract_json(raw)
    problems = check(data, mode, options)
    if problems:
        logger.warning(
            'Invalid JSON completion, requesting repair',
            extra={'model': model_id, 'kind': plan.json_kind, 'problems': problems},
        )
        repaired = _complete(
            provider_factory,
            model_id,
            plan.system,
            _json_repair_prompt(plan, raw, problems),
            JSON_TEMPERATURE,
            json_mode=True,
        )
        fixed = _extract_json(repaired)
        if fixed is not None and len(check(fixed, mode, options)) <= len(problems):
            data = fixed
    return data if isinstance(data, dict) else {}


def _run_searches(queries):
    """[(query, results)] для кожного запиту; помилки пошуку не зупиняють крок."""
    queries = [query for query in queries if query]
    if not queries:
        return []
    _set_live(live_search=queries[0])
    try:
        return _search_all(queries)
    finally:
        _set_live(live_search='')


def _search_all(queries):
    def run(query):
        try:
            return query, search.search(query)
        except search.SearchError as exc:
            logger.warning('Web search failed', extra={'query': query, 'error': str(exc)})
            return query, []

    if len(queries) == 1:
        return [run(queries[0])]
    with ThreadPoolExecutor(max_workers=min(len(queries), MAX_PARALLEL_CALLS)) as pool:
        return list(pool.map(run, queries))


def _run_json_plan(plan, provider_factory, discussion):
    """JSON-крок судді з перемиканням на наступну модель, якщо поточна впала."""
    mode, options = _mode_ctx(discussion)
    models = [plan.model_id, *[m for m in plan.fallback_models if m != plan.model_id]]
    last_error = None
    for model_id in models:
        try:
            data = _complete_json(provider_factory, plan, model_id, mode, options)
        except EngineError as exc:
            if exc.code not in {
                'provider_error',
                'provider_config',
                'provider_quota',
                'empty_response',
            }:
                raise
            last_error = exc
            logger.warning(
                'Judge model failed, trying fallback',
                extra={'model': model_id, 'kind': plan.json_kind},
            )
            continue
        plan.used_model = model_id
        return model_id, data
    raise last_error


def _majority_stance(discussion, personas):
    """Найпоширеніша остання позиція учасників (для режимів з вибором)."""
    latest = {}
    for message in discussion.messages.filter(role=Message.Role.AI).order_by('seq'):
        if message.stance:
            latest[message.persona_slug] = message.stance
    values = [latest[p['slug']] for p in personas if latest.get(p['slug'])]
    if not values:
        return ''
    (value, count), *rest = Counter(values).most_common()
    if rest and rest[0][1] == count:
        return ''
    return value


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
        reply = parse_reply(raw, mode, options)
        if not plan.can_search:
            reply['search_query'] = ''
        reply['search'] = _run_searches([reply['search_query']])
        return reply

    _, data = _run_json_plan(plan, provider_factory, discussion)
    if plan.json_kind == 'solution':
        return normalize_solution(
            data,
            mode,
            options,
            fallback_answer=_majority_stance(discussion, _resolved_personas(discussion)),
        )
    if plan.json_kind == 'review':
        queries = _queries(data.get('search_queries'), MAX_DEVIL_QUERIES) if plan.can_search else []
        return {'review': normalize_review(data), 'search': _run_searches(queries)}
    return normalize_summary(data, discussion.best_solution or {}, mode, options)


def _run_plans(plans, provider_factory, discussion):
    """Виконує виклики (паралельно, якщо їх кілька). Повертає [(plan, payload, error)]."""
    if len(plans) == 1:
        plan = plans[0]
        return [(plan, _run_plan(plan, provider_factory, discussion), None)]

    results = []
    workers = max(1, min(len(plans), MAX_PARALLEL_CALLS))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        # кожен виклик — у копії поточного контексту: так потоки бачать ключі користувача
        futures = [
            pool.submit(
                contextvars.copy_context().run, _run_plan, plan, provider_factory, discussion
            )
            for plan in plans
        ]
        for plan, future in zip(plans, futures):
            try:
                results.append((plan, future.result(), None))
            except EngineError as exc:
                exc.public = (
                    f'{plan.persona["name"]}: {exc.public or generic_public_error()}'
                )[:MAX_ERROR_PUBLIC]
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
                            public=L(
                                f'{plan.persona["name"]}: не вдалося отримати відповідь.',
                                f'{plan.persona["name"]}: could not get a response.',
                            ),
                        ),
                    )
                )
    return results


# ---------------------------------------------------------------------------
# Підготовка кроку
# ---------------------------------------------------------------------------


def _phase_start_seq(messages, phase):
    """Повідомлення фази рахуються від її останнього старту.

    Після уточнення користувача дискусія проходить синтез → Devil → відповіді
    вдруге, тож старі відповіді на Devil не мають зараховуватися новому колу.
    """
    if phase == Discussion.Phase.REBUTTAL:
        return max(
            (message.seq for message in messages if message.role == Message.Role.DEVIL),
            default=0,
        )
    return 0


def _speakers_done(messages, phase):
    start = _phase_start_seq(messages, phase)
    return {
        message.persona_slug
        for message in messages
        if message.role == Message.Role.AI and message.phase == phase and message.seq > start
    }


def _search_budget(discussion):
    if not discussion.web_search or not search.is_available():
        return 0
    return max(0, int(settings.SEARCH_MAX_QUERIES) - (discussion.search_count or 0))


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


def _judge_plan(discussion, personas, judge, **kwargs):
    models = _judge_models(discussion, personas, judge)
    return StepPlan(
        model_id=models[0] if models else _default_model(),
        fallback_models=models[1:],
        temperature=JSON_TEMPERATURE,
        **kwargs,
    )


def _prepare_step(discussion):
    """Будує LLM-виклики для поточного кроку.

    Вступ і відповідь на Devil — паралельні кроки: по виклику на кожного
    учасника, який ще не висловився в цій фазі. Решта фаз — один виклик.
    """
    personas = _resolved_personas(discussion)
    if not personas:
        raise EngineError(
            'У дискусії немає AI-учасників.',
            code='no_personas',
            public=L('У дискусії немає AI-учасників.', 'The discussion has no AI participants.'),
            retryable=False,
        )
    messages = _list_messages(discussion)
    mode, options = _mode_ctx(discussion)
    question = prompts.question_with_clarifications(
        discussion.question, discussion.clarifications
    )
    phase = discussion.phase
    sources = discussion.sources if discussion.web_search else None
    can_search = _search_budget(discussion) > 0
    common = {
        'mode': mode,
        'options': options,
        'rounds': discussion.rounds,
        'consensus': discussion.until_consensus,
        'sources': sources,
    }

    if phase == Discussion.Phase.OPENING:
        done = _speakers_done(messages, phase)
        return [
            _persona_plan(
                persona,
                phase,
                prompts.opening_prompt(
                    question, persona, personas, can_search=can_search, **common
                ),
                can_search=can_search,
            )
            for persona in personas
            if persona['slug'] not in done
        ]

    if phase == Discussion.Phase.DEBATE:
        order = _speaker_order(personas, discussion.current_round)
        if discussion.speaker_index >= len(order):
            raise EngineError(
                'Некоректний індекс учасника дискусії.', code='bad_state', retryable=False
            )
        persona = order[discussion.speaker_index]
        target, reason = _reply_target(messages, persona)
        mine = [m for m in messages if m.role == Message.Role.AI and m.persona_slug == persona['slug']]
        notes = _notes_since(messages, mine[-1].seq if mine else 0)
        reply_to = target.persona_name if target else ''
        reply_to_slug = (USER_SLUG if reason == 'user' else target.persona_slug) if target else ''
        return [
            _persona_plan(
                persona,
                phase,
                prompts.debate_prompt(
                    question,
                    persona,
                    personas,
                    messages,
                    discussion.current_round,
                    reply_to=reply_to,
                    reply_reason=reason,
                    can_search=can_search,
                    user_notes=notes,
                    **common,
                ),
                debate_round=discussion.current_round,
                reply_to=reply_to,
                reply_to_slug=reply_to_slug,
                can_search=can_search,
            )
        ]

    if phase == Discussion.Phase.REBUTTAL:
        done = _speakers_done(messages, phase)
        plans = []
        for persona in personas:
            if persona['slug'] in done:
                continue
            mine = [
                m for m in messages
                if m.role == Message.Role.AI and m.persona_slug == persona['slug']
            ]
            plans.append(
                _persona_plan(
                    persona,
                    phase,
                    prompts.rebuttal_prompt(
                        question,
                        persona,
                        personas,
                        messages,
                        user_notes=_notes_since(messages, mine[-1].seq if mine else 0),
                        **common,
                    ),
                    reply_to=devil()['name'],
                    reply_to_slug=devil()['slug'],
                )
            )
        return plans

    if phase == Discussion.Phase.SYNTHESIS:
        return [
            _judge_plan(
                discussion,
                personas,
                'moderator',
                phase=phase,
                role=Message.Role.MODERATOR,
                persona=moderator(),
                system=prompts.moderator_system(),
                prompt=prompts.synthesis_prompt(
                    question,
                    personas,
                    messages,
                    early_stop=discussion.early_stop,
                    **common,
                ),
                json_kind='solution',
            )
        ]

    if phase == Discussion.Phase.DEVIL:
        return [
            _judge_plan(
                discussion,
                personas,
                'devil',
                phase=phase,
                role=Message.Role.DEVIL,
                persona=devil(),
                system=prompts.devil_system(),
                prompt=prompts.devil_prompt(
                    question,
                    personas,
                    discussion.best_solution or {},
                    messages,
                    can_search=can_search,
                    **common,
                ),
                json_kind='review',
                can_search=can_search,
            )
        ]

    if phase == Discussion.Phase.FINAL:
        return [
            _judge_plan(
                discussion,
                personas,
                'moderator',
                phase=phase,
                role=Message.Role.MODERATOR,
                persona=moderator(),
                system=prompts.moderator_system(),
                prompt=prompts.final_prompt(
                    question,
                    personas,
                    discussion.best_solution or {},
                    discussion.devil_review or {},
                    messages,
                    **common,
                ),
                json_kind='summary',
            )
        ]

    raise EngineError(f'Невідома фаза: {discussion.phase}', code='bad_state', retryable=False)


# ---------------------------------------------------------------------------
# Над чим зараз думають AI — для індикатора «Аналізуємо…»
# ---------------------------------------------------------------------------

FOCUS_QUOTE_LIMIT = 110


def _quote(text, limit=FOCUS_QUOTE_LIMIT):
    """Коротка цитата в лапках: обрізаємо по слову, щоб влізла в один-два рядки."""
    text = ' '.join(str(text or '').split())
    if len(text) > limit:
        text = text[: limit - 1].rsplit(' ', 1)[0].rstrip(' ,.;:—-') + '…'
    return L(f'«{text}»', f'“{text}”') if text else ''


def _thesis_of(message):
    return message.thesis or prompts.fallback_thesis(message.content)


def _focus(persona, text):
    return {'slug': persona['slug'], 'name': persona['name'], 'text': text}


def _question_focus(discussion):
    """Що саме вирішують у вступі: питання й варіанти, а не загальне «формує позицію»."""
    mode, options = _mode_ctx(discussion)
    question = _quote(discussion.question)
    if mode == Discussion.Mode.YES_NO:
        return L(f'вирішує «так» чи «ні»: {question}', f'decides “yes” or “no”: {question}')
    if mode == Discussion.Mode.CHOOSE_ONE and options:
        return L('обирає між ', 'chooses between ') + ', '.join(_quote(option, 40) for option in options[:4])
    return L(f'шукає відповідь на {question}', f'looks for an answer to {question}')


def _stance_tally(messages, personas):
    """«Так — Логік, Скептик; Ні — Емоційний»: останні позиції учасників."""
    latest = {}
    for message in messages:
        if message.role == Message.Role.AI and message.stance:
            latest[message.persona_slug] = message.stance
    groups = {}
    for persona in personas:
        stance = latest.get(persona['slug'])
        if stance:
            groups.setdefault(stance, []).append(persona['name'])
    return '; '.join(
        f'{prompts.stance_label(stance)} — {", ".join(names)}' for stance, names in groups.items()
    )


STATUS_TEMPERATURE = 0.4
STATUS_LIMIT = 70
_THINK_RE = re.compile(r'<think>.*?(</think>|$)', re.IGNORECASE | re.DOTALL)

# Що відбувається на етапі — контекст для моделі, яка пише рядок статусу
STAGE_NOTES = {
    Discussion.Phase.CLARIFY: 'модератор перевіряє, чи вистачає контексту',
    Discussion.Phase.OPENING: 'учасники формують перші позиції',
    Discussion.Phase.DEBATE: 'учасники по черзі сперечаються',
    Discussion.Phase.SYNTHESIS: 'модератор зводить аргументи в рішення',
    Discussion.Phase.DEVIL: 'AI Devil шукає слабкі місця рішення',
    Discussion.Phase.REBUTTAL: 'учасники відповідають на критику',
    Discussion.Phase.FINAL: 'модератор формулює фінальний висновок',
}

STAGE_NOTES_EN = {
    Discussion.Phase.CLARIFY: 'the moderator checks whether there is enough context',
    Discussion.Phase.OPENING: 'the participants form their first positions',
    Discussion.Phase.DEBATE: 'the participants take turns arguing',
    Discussion.Phase.SYNTHESIS: 'the moderator brings the arguments together into a solution',
    Discussion.Phase.DEVIL: 'AI Devil looks for weak spots in the solution',
    Discussion.Phase.REBUTTAL: 'the participants respond to the criticism',
    Discussion.Phase.FINAL: 'the moderator formulates the final conclusion',
}

# Крок, якому належать записи живого статусу: (discussion_id, advance_token)
_live = contextvars.ContextVar('discussion_live', default=None)


def _set_live(phase=None, **fields):
    """Оновлює живий статус поточного кроку; після кроку запис нічого не змінює.

    `phase` — записати, лише якщо дискусія досі в цій фазі: уточнення й вступ
    ідуть одним кроком, і запізнілий статус уточнення не має перекрити вступ.
    """
    live = _live.get()
    if live is None:
        return
    discussion_id, token = live
    scope = {'phase': phase} if phase else {}
    try:
        Discussion.objects.filter(pk=discussion_id, advance_token=token, **scope).update(**fields)
    except Exception as exc:
        # статус — лише підказка інтерфейсу: крок не має падати через нього
        logger.warning('Live status update failed', extra={'error': str(exc)})


def clean_status(raw):
    """Перший змістовний рядок відповіді моделі як «Зважуємо ризики…»."""
    text = _THINK_RE.sub('', str(raw or ''))
    line = next((line for line in text.splitlines() if line.strip()), '')
    line = ' '.join(line.split()).strip(' "\'«»*`#>-—.…!')
    if not line:
        return ''
    if len(line) > STATUS_LIMIT:
        line = line[:STATUS_LIMIT].rsplit(' ', 1)[0].rstrip(' ,;:—-')
    return f'{line[:1].upper()}{line[1:]}…'


def _write_ai_status(discussion, focus, provider_factory):
    try:
        personas = _resolved_personas(discussion)
        model_id = (_judge_models(discussion, personas, 'moderator') or [_default_model()])[0]
        raw = _complete(
            provider_factory,
            model_id,
            prompts.status_system(),
            prompts.status_prompt(
                discussion.question, L(STAGE_NOTES, STAGE_NOTES_EN).get(discussion.phase, ''), focus
            ),
            STATUS_TEMPERATURE,
        )
        text = clean_status(raw)
        if text:
            _set_live(phase=discussion.phase, live_status=text[:120])
    except Exception:
        # статус — прикраса: інтерфейс лишиться з рядком за фазою
        logger.info('AI status skipped', extra={'discussion': str(discussion.pk)}, exc_info=True)
    finally:
        connection.close()


def _start_ai_status(discussion, provider_factory):
    """Фоном просить модель описати крок одним рядком; сам крок не чекає."""
    if not settings.DISCUSSION_AI_STATUS or _live.get() is None:
        return
    focus = describe_step(discussion)
    if not focus:
        return
    _set_live(live_status='')
    context = contextvars.copy_context()
    threading.Thread(
        target=context.run,
        args=(_write_ai_status, discussion, focus, provider_factory),
        daemon=True,
    ).start()


def describe_step(discussion):
    """Над чим конкретно зараз працюють AI: по рядку на кожного, хто думає.

    Нічого не викликає в моделей — лише читає стан, тож безпечно для кожного
    опитування. Повертає [{slug, name, text}], порожньо для завершеної дискусії.
    """
    with using(discussion.language):
        return _describe_step(discussion)


def _describe_step(discussion):
    if discussion.phase == Discussion.Phase.DONE or discussion.status in {
        Discussion.Status.DONE,
        Discussion.Status.FAILED,
    }:
        return []
    personas = _resolved_personas(discussion)
    if not personas:
        return []
    messages = _list_messages(discussion)
    phase = discussion.phase

    if phase == Discussion.Phase.CLARIFY:
        if discussion.clarify_questions:
            return []
        return [_focus(moderator(), L(
            'перевіряє, чи вистачає контексту для відповіді',
            'checks whether there is enough context for an answer',
        ))]

    if phase == Discussion.Phase.OPENING:
        done = _speakers_done(messages, phase)
        text = _question_focus(discussion)
        return [_focus(persona, text) for persona in personas if persona['slug'] not in done]

    if phase == Discussion.Phase.DEBATE:
        order = _speaker_order(personas, discussion.current_round)
        if discussion.speaker_index >= len(order):
            return []
        persona = order[discussion.speaker_index]
        target, reason = _reply_target(messages, persona)
        if target is None:
            return [_focus(persona, L('розвиває власну позицію', 'develops their own position'))]
        quote = _quote(_thesis_of(target)) if reason != 'user' else _quote(target.content)
        if reason == 'user':
            return [_focus(persona, L(
                f'відповідає на ваше уточнення {quote}', f'answers your clarification {quote}'
            ))]
        verb = L({
            'question': 'відповідає на звернення',
            'disagree': 'сперечається з тезою',
        }, {
            'question': 'answers the question',
            'disagree': 'disputes the point',
        }).get(reason, L('розбирає тезу', 'examines the point'))
        return [_focus(persona, f'→ {target.persona_name} · {verb} {quote}')]

    if phase == Discussion.Phase.SYNTHESIS:
        tally = _stance_tally(messages, personas)
        text = (
            L(f'зважує позиції: {tally}', f'weighs the positions: {tally}')
            if tally
            else L('зводить аргументи учасників у рішення', 'brings the arguments together into a solution')
        )
        return [_focus(moderator(), text)]

    solution = discussion.best_solution or {}
    answer = solution.get('answer')
    decision = _quote(prompts.stance_label(answer) if answer else solution.get('decision'))

    if phase == Discussion.Phase.DEVIL:
        text = L('шукає слабкі місця в рішенні', 'looks for weak spots in the solution')
        if decision:
            text = f'{text} {decision}'
        return [_focus(devil(), text)]

    review = discussion.devil_review or {}
    risks = review.get('risks') or []
    critique = _quote(risks[0].get('title') if risks else review.get('verdict'))

    if phase == Discussion.Phase.REBUTTAL:
        done = _speakers_done(messages, phase)
        text = f'→ {devil()["name"]} · ' + L('відповідає на критику', 'responds to the criticism')
        if critique:
            text = f'{text} {critique}'
        return [_focus(persona, text) for persona in personas if persona['slug'] not in done]

    if phase == Discussion.Phase.FINAL:
        text = (
            L(f'зважує критику {critique} і формулює висновок',
              f'weighs the criticism {critique} and formulates the conclusion')
            if critique
            else L('формулює фінальний висновок', 'formulates the final conclusion')
        )
        return [_focus(moderator(), text)]

    return []


# ---------------------------------------------------------------------------
# Тексти повідомлень судді
# ---------------------------------------------------------------------------


def _bullets(items):
    """Markdown-список: кожен пункт з нового рядка, без хвостових розділових знаків."""
    return '\n'.join(f'- {item.rstrip(" .;")}' for item in items if item.rstrip(' .;'))


def _section(title, body):
    return f'### {title}\n\n{body}' if body else ''


def _unbold(text):
    """Знімає **жирний** моделі з тексту, який ми й так обгортаємо в **…**."""
    return text.replace('**', '')


def _no_decision():
    return L('рішення не визначено', 'no solution was determined')


def _answer_line(value):
    """«**Відповідь: так**»: відповідь у тексті — мовою дискусії."""
    answer = _unbold(_text(value, limit=200))
    if not answer:
        return ''
    return L(f'**Відповідь: {answer}**', f'**Answer: {prompts.stance_label(answer)}**')


def _moderator_text(best_solution):
    best_solution = best_solution if isinstance(best_solution, dict) else {}
    decision = _text(best_solution.get('decision'), _no_decision(), limit=2000)
    reasoning = _text(best_solution.get('reasoning'), limit=4000)
    args = _bullets(_text_list(best_solution.get('supporting_arguments'), limit=4))
    dissent = _bullets(_text_list(best_solution.get('dissenting_points'), limit=4))
    parts = [_answer_line(best_solution.get('answer'))]
    parts.append(_section(L('Пропоноване рішення', 'Proposed solution'), decision))
    if reasoning:
        parts.append(reasoning)
    parts.append(_section(L('Аргументи на користь', 'Arguments in favour'), args))
    parts.append(_section(L('Що лишилось спірним', 'What remains disputed'), dissent))
    return '\n\n'.join(part for part in parts if part).strip()


def _devil_text(review):
    review = review if isinstance(review, dict) else {}
    parts = []
    verdict = _unbold(_text(review.get('verdict'), limit=1000))
    if verdict:
        parts.append(f'**{verdict.rstrip()}**')

    risks = []
    for risk in review.get('risks') or []:
        if not isinstance(risk, dict):
            continue
        title = _unbold(_text(risk.get('title'), limit=300)).rstrip(' .;')
        description = _text(risk.get('description'), limit=1000).rstrip(' .;')
        severity = _text(risk.get('severity'), limit=40)
        if not (title or description):
            continue
        line = f'**{title}** — {description}' if title and description else f'**{_unbold(title or description)}**'
        if severity:
            line += L(f' _(ризик: {severity})_', f' _(risk: {severity})_')
        risks.append(f'- {line}')
    if risks:
        parts.append(_section(L('Ризики', 'Risks'), '\n'.join(risks)))

    parts.append(_section(
        L('Слабкі місця', 'Weak spots'), _bullets(_text_list(review.get('weak_spots'), limit=3))
    ))
    parts.append(_section(
        L('Контраргументи', 'Counterarguments'),
        _bullets(_text_list(review.get('counter_arguments'), limit=3)),
    ))
    text = '\n\n'.join(part for part in parts if part).strip()
    return text or L('AI Devil не знайшов додаткових ризиків.', 'AI Devil found no additional risks.')


def _final_text(summary):
    summary = summary if isinstance(summary, dict) else {}
    parts = [_answer_line(summary.get('answer'))]

    decision = _text(summary.get('decision'), _no_decision(), limit=2000)
    parts.append(_section(L('Фінальне рішення', 'Final solution'), decision))

    if summary.get('confirmed') is False:
        revision = _text(summary.get('revision'), limit=2000)
        text = L(
            'Висновок **переглянуто** після перевірки AI Devil.',
            'The conclusion was **revised** after AI Devil’s review.',
        )
        if revision:
            text = f'{text} {L("Що змінилось", "What changed")}: {revision}'
        parts.append(text)
    elif summary.get('confirmed') is True:
        parts.append(L(
            'Висновок **підтверджено** після перевірки AI Devil.',
            'The conclusion was **confirmed** after AI Devil’s review.',
        ))

    agreement = summary.get('agreement') or {}
    if agreement.get('total'):
        agree, total = agreement.get('agree', 0), agreement['total']
        parts.append(L(
            f'Згода учасників: **{agree} з {total}**.',
            f'Participant agreement: **{agree} of {total}**.',
        ))

    parts.append(_section(
        L('Окремі думки', 'Dissenting opinions'),
        _bullets(_text_list(summary.get('dissenting_points'), limit=4)),
    ))
    parts.append(_section(
        L('Що робити далі', 'What to do next'), _text(summary.get('recommendation'), limit=2000)
    ))
    return '\n\n'.join(part for part in parts if part).strip()


def _merge_sources(discussion, found, added_by):
    """Додає знайдене до discussion.sources без дублікатів. Повертає нові id."""
    sources = list(discussion.sources or [])
    known = {source.get('url') for source in sources}
    limit = int(settings.SEARCH_MAX_SOURCES)
    added = []
    queries = 0
    for query, items in found or []:
        queries += 1
        for item in items:
            if len(sources) >= limit:
                break
            if item.get('url') in known:
                continue
            known.add(item['url'])
            source_id = len(sources) + 1
            sources.append({**item, 'id': source_id, 'query': query, 'added_by': added_by})
            added.append(source_id)
    discussion.sources = sources
    discussion.search_count = (discussion.search_count or 0) + queries
    return added


def _agreement(discussion, personas, answer):
    """Скільки учасників наприкінці підтримують висновок — за їхніми позиціями.

    `votes` — остання позиція кожного учасника: з неї підсумок малює, хто за що.
    """
    messages = list(discussion.messages.order_by('seq'))
    devil_seq = _phase_start_seq(messages, Discussion.Phase.REBUTTAL)
    agree = disagree = unknown = 0
    votes = []
    for persona in personas:
        mine = [
            m for m in messages
            if m.role == Message.Role.AI and m.persona_slug == persona['slug'] and m.stance
        ]
        after_devil = [m for m in mine if m.seq > devil_seq]
        stance = (after_devil or mine)[-1].stance if (after_devil or mine) else ''
        votes.append({'name': persona.get('name') or '', 'stance': stance or ''})
        if not stance:
            unknown += 1
        elif discussion.mode == Discussion.Mode.OPEN:
            if stance == STANCE_AGREE:
                agree += 1
            else:
                disagree += 1
        elif answer:
            if stance.casefold() == str(answer).casefold():
                agree += 1
            else:
                disagree += 1
        else:
            unknown += 1
    return {
        'agree': agree,
        'disagree': disagree,
        'unknown': unknown,
        'total': len(personas),
        'votes': votes,
    }


# ---------------------------------------------------------------------------
# Lease, heartbeat і збереження
# ---------------------------------------------------------------------------


class _Heartbeat:
    """Продовжує lease, доки триває довгий крок (повтори, кілька викликів)."""

    def __init__(self, discussion_id, token):
        self.discussion_id = discussion_id
        self.token = token
        self.interval = max(1.0, float(settings.LLM_HEARTBEAT_SECONDS))
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()

    def _run(self):
        touched = False
        try:
            while not self.stop_event.wait(self.interval):
                touched = True
                Discussion.objects.filter(
                    pk=self.discussion_id, advance_token=self.token
                ).update(advance_started_at=timezone.now())
        except Exception:
            logger.exception('Lease heartbeat failed')
        finally:
            if touched:
                connection.close()


def _lease_active(discussion, now=None):
    if not discussion.advance_token:
        return False
    now = now or timezone.now()
    started = discussion.advance_started_at or now
    return started + timedelta(seconds=settings.LLM_ADVANCE_LEASE_SECONDS) > now


def is_running(discussion):
    return _lease_active(discussion)


def _claim(discussion_id, token):
    """Атомарно резервує крок. Повертає свіжий Discussion або None для done."""
    now = timezone.now()
    with transaction.atomic():
        discussion = (
            Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        )
        if discussion is None:
            raise EngineError('Дискусію не знайдено.', code='not_found', retryable=False)
        if discussion.phase == Discussion.Phase.DONE:
            return None
        if _lease_active(discussion, now):
            raise EngineBusy(
                'Дискусія вже обробляється. Зачекайте кілька секунд.',
                code='busy',
            )
        discussion.advance_token = token
        discussion.advance_started_at = now
        discussion.advance_count = (discussion.advance_count or 0) + 1
        discussion.live_token = token
        discussion.live_status = ''
        discussion.live_search = ''
        if discussion.status in {Discussion.Status.NEW, Discussion.Status.FAILED}:
            discussion.status = Discussion.Status.IN_PROGRESS
            discussion.error = ''
            discussion.error_code = ''
            discussion.error_public = ''
        discussion.save(
            update_fields=[
                'advance_token',
                'advance_started_at',
                'advance_count',
                'live_token',
                'live_status',
                'live_search',
                'status',
                'error',
                'error_code',
                'error_public',
                'updated_at',
            ]
        )
        return discussion


def _set_error(discussion, exc):
    discussion.status = Discussion.Status.FAILED
    discussion.error = str(exc.detail or '')[:MAX_ERROR_DETAIL]
    discussion.error_code = exc.code[:32]
    discussion.error_public = (exc.public or generic_public_error())[:MAX_ERROR_PUBLIC]


def _fail(discussion_id, token, exc):
    """Позначає крок failed, але лише якщо lease все ще належить цьому запиту."""
    with transaction.atomic():
        discussion = (
            Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        )
        if discussion is None or discussion.advance_token != token:
            return
        _set_error(discussion, exc)
        discussion.advance_token = None
        discussion.advance_started_at = None
        discussion.save(
            update_fields=[
                'status',
                'error',
                'error_code',
                'error_public',
                'advance_token',
                'advance_started_at',
                'updated_at',
            ]
        )


def _round_value(discussion, personas, debate_round):
    """Спільна позиція всіх учасників у раунді або '' (0 — вступні слова)."""
    query = Message.objects.filter(discussion=discussion, role=Message.Role.AI)
    if debate_round == 0:
        query = query.filter(phase=Discussion.Phase.OPENING)
    else:
        query = query.filter(phase=Discussion.Phase.DEBATE, round=debate_round)
    stances = dict(query.order_by('seq').values_list('persona_slug', 'stance'))
    values = [stances.get(persona['slug'], '') for persona in personas]
    if not values or not all(values) or len(set(values)) != 1:
        return ''
    return values[0]


def _should_stop_early(discussion, personas):
    """Дострокове завершення: однакова позиція два раунди поспіль.

    Один раунд згоди LLM-учасників часто означає ввічливе підтакування, а не
    консенсус, тож потрібне підтвердження. Для «Так/ні» та «Варіантів» першим
    з двох може бути вступ; у вільному режимі у вступі позиції немає, тому
    потрібні два раунди дебатів зі «згодою».
    """
    current = discussion.current_round
    value = _round_value(discussion, personas, current)
    if not value:
        return False
    if discussion.mode == Discussion.Mode.OPEN:
        if value != STANCE_AGREE or current < 2:
            return False
    return _round_value(discussion, personas, current - 1) == value


def _next_speaker_transition(discussion, personas):
    next_index = discussion.speaker_index + 1
    if next_index < len(personas):
        discussion.speaker_index = next_index
        return
    discussion.speaker_index = 0
    agreed = _should_stop_early(discussion, personas)
    if discussion.current_round < discussion.rounds and not agreed:
        discussion.current_round += 1
        return
    # у режимі «до повної згоди» згода в останньому дозволеному раунді — теж згода;
    # без неї early_stop лишається false, і видно, що до згоди не дійшли
    discussion.early_stop = discussion.current_round < discussion.rounds or (
        discussion.until_consensus and agreed
    )
    discussion.phase = Discussion.Phase.SYNTHESIS


def _all_spoke(discussion, personas, phase):
    done = _speakers_done(_list_messages(discussion), phase)
    return all(persona['slug'] in done for persona in personas)


def _store(discussion, plan, payload, personas):
    if plan.role == Message.Role.AI:
        added = _merge_sources(discussion, payload.get('search'), plan.persona['name'])
        return _add_message(
            discussion,
            persona=plan.persona,
            role=Message.Role.AI,
            phase=plan.phase,
            content=payload['content'],
            debate_round=plan.debate_round,
            reply_to=plan.reply_to,
            reply_to_slug=plan.reply_to_slug,
            thesis=payload['thesis'],
            stance=payload['stance'],
            search_query=payload.get('search_query', ''),
            source_ids=added,
            model_id=plan.used_model or plan.model_id,
        )
    search_query = ''
    added = []
    if plan.phase == Discussion.Phase.SYNTHESIS:
        discussion.best_solution = payload
        content = _moderator_text(payload)
    elif plan.phase == Discussion.Phase.DEVIL:
        discussion.devil_review = payload['review']
        added = _merge_sources(discussion, payload.get('search'), devil()['name'])
        search_query = '; '.join(query for query, _ in payload.get('search') or [])
        content = _devil_text(payload['review'])
    elif plan.phase == Discussion.Phase.FINAL:
        payload['agreement'] = _agreement(discussion, personas, payload.get('answer'))
        discussion.final_summary = payload
        content = _final_text(payload)
    else:
        raise EngineError(f'Невідома фаза: {plan.phase}', code='bad_state', retryable=False)
    return _add_message(
        discussion,
        persona=plan.persona,
        role=plan.role,
        phase=plan.phase,
        content=content,
        search_query=search_query,
        source_ids=added,
        model_id=plan.used_model or plan.model_id,
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
        raise EngineError(f'Невідома фаза: {phase}', code='bad_state', retryable=False)


def _commit(discussion_id, token, phase, results, error=None):
    """Зберігає результати кроку. Якщо частина паралельних викликів упала,
    зберігає вдалі відповіді й позначає дискусію failed без переходу фази."""
    with transaction.atomic():
        discussion = (
            Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        )
        if discussion is None:
            raise EngineError('Дискусію не знайдено.', code='not_found', retryable=False)
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
        created = [_store(discussion, plan, payload, personas) for plan, payload in results]
        usage.record(discussion.user_id, replies=len(created))
        if error is not None:
            _set_error(discussion, error)
        else:
            _transition(discussion, personas)
            discussion.error = ''
            discussion.error_code = ''
            discussion.error_public = ''

        discussion.advance_token = None
        discussion.advance_started_at = None
        discussion.save()
        return created


def advance(discussion, provider_factory=None):
    """Робить один крок дискусії.

    Повертає список створених повідомлень: одне для звичайного кроку, кілька
    для паралельних фаз, порожній — якщо дискусію вже завершено. Промпти,
    тексти суддів і помилки — мовою, якою дискусію створено.
    """
    if discussion is None or not getattr(discussion, 'pk', None):
        raise EngineError('Дискусію не знайдено.', code='not_found', retryable=False)
    with using(discussion.language):
        return _advance(discussion, provider_factory)


def _advance(discussion, provider_factory):

    discussion_id = discussion.pk
    token = uuid.uuid4()
    claimed = _claim(discussion_id, token)
    if claimed is None:
        return []

    heartbeat = _Heartbeat(discussion_id, token)
    heartbeat.start()
    live = _live.set((discussion_id, token))
    try:
        if claimed.phase == Discussion.Phase.CLARIFY:
            _start_ai_status(claimed, provider_factory)
            if not _clarify_step(claimed, token, provider_factory):
                return []
            # контексту досить — у тому ж кроці починаємо вступ
            claimed.phase = Discussion.Phase.OPENING
        _start_ai_status(claimed, provider_factory)
        plans = _prepare_step(claimed)
        results = _run_plans(plans, provider_factory, claimed) if plans else []
        succeeded = [(plan, payload) for plan, payload, error in results if error is None]
        errors = [error for _, _, error in results if error is not None]
        if errors and not succeeded:
            raise errors[0]
        combined = None
        if errors:
            combined = EngineError(
                str(errors[0]),
                detail='; '.join(error.detail for error in errors),
                code=errors[0].code,
                public=errors[0].public,
                retryable=all(error.retryable for error in errors),
            )
        created = _commit(discussion_id, token, claimed.phase, succeeded, combined)
        if combined is not None:
            raise combined
        return created

    except EngineBusy:
        raise
    except EngineConflict:
        raise
    except EngineError as exc:
        _fail(discussion_id, token, exc)
        raise
    except Exception as exc:
        logger.exception('Unexpected engine failure', extra={'discussion': str(discussion_id)})
        error = EngineError(
            'Не вдалося продовжити дискусію через внутрішню помилку.',
            detail=f'{type(exc).__name__}: {exc}',
            code='internal_error',
            public=L(
                'Внутрішня помилка сервера. Спробуйте продовжити ще раз.',
                'Internal server error. Please try to continue again.',
            ),
        )
        _fail(discussion_id, token, error)
        raise error from exc
    finally:
        _live.reset(live)
        heartbeat.stop()


# ---------------------------------------------------------------------------
# Уточнення користувача
# ---------------------------------------------------------------------------


def _not_found():
    return L('Дискусію не знайдено.', 'Discussion not found.')


def add_user_message(discussion_id, author_name, content):
    """Додає уточнення користувача.

    Під час дискусії воно потрапляє в історію, і наступні учасники на нього
    реагують. Після фіналу — відкриває ще один раунд дебатів, після якого
    синтез, перевірка Devil і фінал проходять заново.
    Повертає (message, reopened).
    """
    content = _text(content, limit=int(settings.DISCUSSION_NOTE_MAX_CHARS))
    if not content:
        raise EngineError(
            'Повідомлення порожнє.',
            code='empty_note',
            public=L('Повідомлення порожнє.', 'The message is empty.'),
            retryable=False,
        )
    with transaction.atomic():
        discussion = (
            Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        )
        if discussion is None:
            raise EngineError(
                'Дискусію не знайдено.',
                code='not_found',
                public=_not_found(),
                retryable=False,
            )
        if discussion.awaiting_clarification:
            raise EngineError(
                'Модератор чекає відповідей на уточнення.',
                code='clarify_pending',
                public=L(
                    'Спершу дайте відповідь на питання модератора або пропустіть їх.',
                    'First answer the moderator’s questions or skip them.',
                ),
                retryable=False,
            )
        reopened = discussion.phase == Discussion.Phase.DONE
        if reopened:
            limit = int(settings.DISCUSSION_MAX_FOLLOWUPS)
            if discussion.followups >= limit:
                raise EngineError(
                    'Ліміт уточнень вичерпано.',
                    code='followup_limit',
                    public=L(
                        f'Після фіналу можна поставити не більше {limit} уточнень. '
                        'Створіть нову дискусію.',
                        f'You can ask no more than {limit} follow-ups after the final. '
                        'Start a new discussion.',
                    ),
                    retryable=False,
                )
            discussion.followups += 1
            discussion.current_round += 1
            discussion.rounds = discussion.current_round
            discussion.speaker_index = 0
            discussion.early_stop = False
            discussion.finished_early = False
            discussion.phase = Discussion.Phase.DEBATE
            discussion.status = Discussion.Status.IN_PROGRESS
            discussion.finished_at = None
        discussion.stop_requested = False
        phase = discussion.phase
        message = Message.objects.create(
            discussion=discussion,
            seq=_next_seq(discussion),
            phase=phase,
            round=discussion.current_round if phase == Discussion.Phase.DEBATE else None,
            role=Message.Role.USER,
            persona_slug=USER_SLUG,
            persona_name=author_name or L('Користувач', 'User'),
            avatar='🧑',
            content=content,
        )
        discussion.save()
        return message, reopened


# ---------------------------------------------------------------------------
# Перевірка контексту перед стартом
# ---------------------------------------------------------------------------


def clarify(discussion, provider_factory=None):
    """Модератор вирішує, чи досить контексту, або ставить уточнювальні питання.

    Якщо жодна модель модератора не відповіла, піднімається EngineError.
    """
    personas = _resolved_personas(discussion)
    mode, options = _mode_ctx(discussion)
    plan = StepPlan(
        phase=Discussion.Phase.OPENING,
        role=Message.Role.MODERATOR,
        persona=moderator(),
        model_id='',
        system=prompts.clarify_system(),
        prompt=prompts.clarify_prompt(discussion.question, mode, options),
        temperature=JSON_TEMPERATURE,
        json_kind='clarify',
    )
    last_error = None
    for model_id in _judge_models(discussion, personas, 'moderator')[:2]:
        try:
            data = _complete_json(provider_factory, plan, model_id, mode, options)
        except EngineError as exc:
            last_error = exc
            continue
        return normalize_clarify(data)
    raise last_error or EngineError('Немає доступної моделі модератора.', code='provider_config')


def _release(discussion_id, token, **changes):
    """Знімає lease кроку, зберігаючи зміни, якщо крок досі наш."""
    return Discussion.objects.filter(pk=discussion_id, advance_token=token).update(
        advance_token=None, advance_started_at=None, updated_at=timezone.now(), **changes
    )


def _clarify_step(discussion, token, provider_factory=None):
    """Крок перевірки контексту. True — можна починати вступ (lease лишається
    за кроком), False — чекаємо відповідей користувача (lease знято).

    Збій модератора не блокує дискусію: тоді просто стартуємо без питань.
    """
    if discussion.clarify_questions:
        _release(discussion.pk, token)
        return False
    try:
        result = clarify(discussion, provider_factory)
    except EngineError:
        logger.warning('Context check failed', extra={'discussion': str(discussion.pk)}, exc_info=True)
        result = {'ready': True, 'questions': []}
    else:
        usage.record(discussion.user_id, replies=1)
    if result['ready']:
        updated = Discussion.objects.filter(pk=discussion.pk, advance_token=token).update(
            phase=Discussion.Phase.OPENING
        )
        if not updated:
            raise EngineConflict('Дискусію вже оновив інший запит.', code='conflict')
        return True
    if not _release(discussion.pk, token, clarify_questions=result['questions']):
        raise EngineConflict('Дискусію вже оновив інший запит.', code='conflict')
    return False


def finish_early(discussion_id):
    """Обриває дискусію за проханням користувача — одразу й без висновку.

    Модератор нічого не підсумовує: решту раундів, перевірку AI Devil і фінал
    пропускаємо. Крок, що ще виконується, відкидається (як під час зупинки).
    Повертає дискусію.
    """
    with transaction.atomic():
        discussion = (
            Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        )
        if discussion is None:
            raise EngineError(
                'Дискусію не знайдено.', code='not_found', public=_not_found(),
                retryable=False,
            )
        if discussion.phase == Discussion.Phase.DONE:
            raise EngineError(
                'Дискусію вже завершено.',
                code='bad_state',
                public=L('Дискусію вже завершено.', 'The discussion has already finished.'),
                retryable=False,
            )
        spoke = Message.objects.filter(discussion=discussion, role=Message.Role.AI).exists()
        if not spoke or discussion.awaiting_clarification:
            raise EngineError(
                'Учасники ще не висловились.',
                code='nothing_to_finish',
                public=L(
                    'Учасники ще не висловились — висновок робити ні з чого. '
                    'Натисніть «Продовжити».',
                    'The participants have not spoken yet — there is nothing to conclude. '
                    'Press “Continue”.',
                ),
                retryable=False,
            )
        discussion.phase = Discussion.Phase.DONE
        discussion.status = Discussion.Status.DONE
        discussion.finished_at = timezone.now()
        # висновок попереднього раунду (до уточнення) цієї розмови вже не підсумовує
        discussion.final_summary = None
        discussion.finished_early = True
        discussion.stop_requested = False
        discussion.advance_token = None
        discussion.advance_started_at = None
        discussion.live_token = None
        discussion.save()
        return discussion


def answer_clarification(discussion_id, clarifications):
    """Зберігає відповіді на питання модератора й відкриває вступ.

    Порожній список — користувач пропустив питання. Повертає дискусію.
    """
    with transaction.atomic():
        discussion = (
            Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        )
        if discussion is None:
            raise EngineError(
                'Дискусію не знайдено.', code='not_found', public=_not_found(),
                retryable=False,
            )
        if not discussion.awaiting_clarification:
            raise EngineError(
                'Модератор не чекає уточнень.',
                code='no_clarify',
                public=L(
                    'Модератор уже не чекає уточнень — дискусія триває.',
                    'The moderator is no longer waiting for clarifications — the discussion is on.',
                ),
                retryable=False,
            )
        discussion.clarifications = clarifications
        discussion.clarify_questions = []
        discussion.phase = Discussion.Phase.OPENING
        discussion.stop_requested = False
        discussion.save()
        return discussion
