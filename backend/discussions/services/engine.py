"""Движок дискусії: стан-машина, яка робить один крок за виклик.

Фази: opening → debate (N раундів) → synthesis → devil → final → done.
Один крок = одне повідомлення в чаті. Кожен AI-учасник викликає власну модель,
а модератор і AI Devil використовують модель першого учасника.
"""

import json
import re

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ..models import Discussion, Message
from ..personas import DEVIL, MODERATOR, PERSONA_BY_SLUG
from . import prompts
from .catalog import default_model_id
from .providers import ProviderError, get_provider

MAX_SEQ_STEP = 1
DEFAULT_TEMPERATURE = 0.8


class EngineError(Exception):
    pass


_CODE_FENCE_RE = re.compile(r'^```(?:json)?\s*|\s*```$', re.MULTILINE)


def parse_json(raw, fallback):
    text = _CODE_FENCE_RE.sub('', raw.strip()).strip()
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    return fallback


def _next_seq(discussion):
    last = discussion.messages.order_by('-seq').values_list('seq', flat=True).first()
    return (last or 0) + MAX_SEQ_STEP


def _add_message(discussion, *, persona, role, phase, content, debate_round=None):
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
    )


def _list_messages(discussion):
    return list(discussion.messages.order_by('seq'))


def _default_model():
    return default_model_id() or settings.LLM_DEFAULT_MODEL


def _resolved_personas(discussion):
    """Повертає персон з усіма user-оверайдами: name, style, traits, model."""
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
        persona.setdefault('temperature', DEFAULT_TEMPERATURE)
        persona['model'] = _default_model()
        persona['traits'] = []
        if isinstance(item, dict):
            if item.get('name'):
                persona['name'] = item['name']
            if item.get('style'):
                persona['custom_style'] = item['style']
            if item.get('traits'):
                persona['traits'] = list(item['traits'])
            if item.get('model'):
                persona['model'] = item['model']
            if item.get('temperature') is not None:
                persona['temperature'] = float(item['temperature'])
        resolved.append(persona)
    return resolved


def _model_for_persona(persona):
    return persona.get('model') or _default_model()


def _moderator_model(personas):
    if personas:
        return _model_for_persona(personas[0])
    return _default_model()


def _mode_ctx(discussion):
    return discussion.mode, list(discussion.options or [])


def _move_to(discussion, *, phase=None, status=None, round=None, speaker_index=None, finished=False):
    if phase is not None:
        discussion.phase = phase
    if status is not None:
        discussion.status = status
    if round is not None:
        discussion.current_round = round
    if speaker_index is not None:
        discussion.speaker_index = speaker_index
    if finished:
        discussion.finished_at = timezone.now()
    discussion.save()


def _complete(
    provider_factory,
    model_id,
    system,
    prompt,
    temperature=DEFAULT_TEMPERATURE,
):
    try:
        provider = provider_factory(model_id) if provider_factory else get_provider(model_id)
        return provider.complete(system=system, prompt=prompt, temperature=temperature)
    except ProviderError as exc:
        raise EngineError(f'{model_id}: {exc}') from exc


def _moderator_text(best_solution):
    decision = best_solution.get('decision', 'рішення не визначено')
    reasoning = best_solution.get('reasoning', '')
    args = '; '.join(best_solution.get('supporting_arguments', [])[:4])
    paragraphs = []
    answer = best_solution.get('answer')
    if answer:
        paragraphs.append(f'Відповідь: {answer}')
    paragraphs.append(f'Пропоноване рішення: {decision}')
    if reasoning:
        paragraphs.append(reasoning)
    if args:
        paragraphs.append(f'Аргументи на користь рішення: {args}.')
    return '\n\n'.join(paragraphs).strip()


def _devil_text(review):
    paragraphs = []
    verdict = review.get('verdict', '')
    if verdict:
        paragraphs.append(verdict)

    for risk in review.get('risks', []):
        title = risk.get('title', '')
        description = risk.get('description', '')
        severity = risk.get('severity', '')
        details = ' — '.join(part for part in (title, description) if part)
        if details:
            suffix = f' (ризик: {severity})' if severity else ''
            paragraphs.append(f'{details}{suffix}.')

    weak_spots = review.get('weak_spots', [])[:3]
    if weak_spots:
        paragraphs.append(f'Слабкі місця: {"; ".join(weak_spots)}.')

    counter_arguments = review.get('counter_arguments', [])[:3]
    if counter_arguments:
        paragraphs.append(f'Контраргументи: {"; ".join(counter_arguments)}.')

    return '\n\n'.join(paragraphs).strip()


def _final_text(summary):
    paragraphs = []
    confirmed = summary.get('confirmed')
    answer = summary.get('answer')
    if answer:
        paragraphs.append(f'Відповідь: {answer}')

    decision = summary.get('decision', '')
    paragraphs.append(f'Фінальне рішення: {decision}')

    if confirmed is False:
        revision = summary.get('revision')
        text = 'Висновок переглянуто після перевірки AI Devil.'
        if revision:
            text = f'{text} Що змінилось: {revision}'
        paragraphs.append(text)
    else:
        paragraphs.append('Висновок підтверджено після перевірки AI Devil.')

    confidence = summary.get('confidence', '—')
    paragraphs.append(f'Впевненість: {confidence}%.')

    if summary.get('recommendation'):
        paragraphs.append(f'Що робити далі: {summary["recommendation"]}')
    return '\n\n'.join(paragraphs).strip()


@transaction.atomic
def advance(discussion, provider_factory=None):
    """Робить один крок дискусії. Повертає нове Message або None, якщо все готово."""
    if discussion.phase == Discussion.Phase.DONE:
        return None

    if discussion.status in {Discussion.Status.FAILED, Discussion.Status.NEW}:
        discussion.status = Discussion.Status.IN_PROGRESS
        discussion.error = ''
        discussion.save(update_fields=['status', 'error', 'updated_at'])

    try:
        message = _step(discussion, provider_factory)
    except EngineError:
        _move_to(discussion, status=Discussion.Status.FAILED)
        raise

    return message


def _step(discussion, provider_factory):
    handler = {
        Discussion.Phase.OPENING: _step_opening,
        Discussion.Phase.DEBATE: _step_debate,
        Discussion.Phase.SYNTHESIS: _step_synthesis,
        Discussion.Phase.DEVIL: _step_devil,
        Discussion.Phase.FINAL: _step_final,
    }.get(discussion.phase)

    if handler is None:
        raise EngineError(f'Невідома фаза: {discussion.phase}')
    return handler(discussion, provider_factory)


def _step_opening(discussion, provider_factory):
    personas = _resolved_personas(discussion)
    if not personas:
        raise EngineError('У дискусії немає AI-учасників')
    persona = personas[discussion.speaker_index]
    mode, options = _mode_ctx(discussion)
    content = _complete(
        provider_factory,
        _model_for_persona(persona),
        system=prompts.SYSTEM_BASE,
        prompt=prompts.opening_prompt(
            discussion.question,
            persona,
            personas,
            _list_messages(discussion),
            mode=mode,
            options=options,
            rounds=discussion.rounds,
        ),
        temperature=persona.get('temperature', DEFAULT_TEMPERATURE),
    )
    message = _add_message(
        discussion,
        persona=persona,
        role=Message.Role.AI,
        phase=Discussion.Phase.OPENING,
        content=content,
    )

    next_index = discussion.speaker_index + 1
    if next_index >= len(personas):
        _move_to(
            discussion,
            phase=Discussion.Phase.DEBATE,
            round=1,
            speaker_index=0,
        )
    else:
        _move_to(discussion, speaker_index=next_index)
    return message


def _step_debate(discussion, provider_factory):
    personas = _resolved_personas(discussion)
    if not personas:
        raise EngineError('У дискусії немає AI-учасників')
    persona = personas[discussion.speaker_index]
    mode, options = _mode_ctx(discussion)
    content = _complete(
        provider_factory,
        _model_for_persona(persona),
        system=prompts.SYSTEM_BASE,
        prompt=prompts.debate_prompt(
            discussion.question,
            persona,
            personas,
            _list_messages(discussion),
            discussion.current_round,
            mode=mode,
            options=options,
            rounds=discussion.rounds,
        ),
        temperature=persona.get('temperature', DEFAULT_TEMPERATURE),
    )
    message = _add_message(
        discussion,
        persona=persona,
        role=Message.Role.AI,
        phase=Discussion.Phase.DEBATE,
        content=content,
        debate_round=discussion.current_round,
    )

    next_index = discussion.speaker_index + 1
    if next_index < len(personas):
        _move_to(discussion, speaker_index=next_index)
    elif discussion.current_round < discussion.rounds:
        _move_to(discussion, round=discussion.current_round + 1, speaker_index=0)
    else:
        _move_to(discussion, phase=Discussion.Phase.SYNTHESIS, speaker_index=0)
    return message


def _step_synthesis(discussion, provider_factory):
    personas = _resolved_personas(discussion)
    messages = _list_messages(discussion)
    mode, options = _mode_ctx(discussion)
    raw = _complete(
        provider_factory,
        _moderator_model(personas),
        system=prompts.MODERATOR_SYSTEM,
        prompt=prompts.synthesis_prompt(
            discussion.question,
            personas,
            MODERATOR,
            messages,
            mode=mode,
            options=options,
            rounds=discussion.rounds,
        ),
    )
    best_solution = parse_json(
        raw,
        fallback={
            'decision': 'Рішення не сформовано (помилка розбору відповіді)',
            'reasoning': raw[:500],
            'supporting_arguments': [],
            'dissenting_points': [],
        },
    )
    discussion.best_solution = best_solution
    discussion.save(update_fields=['best_solution', 'updated_at'])

    message = _add_message(
        discussion,
        persona=MODERATOR,
        role=Message.Role.MODERATOR,
        phase=Discussion.Phase.SYNTHESIS,
        content=_moderator_text(best_solution),
    )
    _move_to(discussion, phase=Discussion.Phase.DEVIL)
    return message


def _step_devil(discussion, provider_factory):
    personas = _resolved_personas(discussion)
    messages = _list_messages(discussion)
    mode, options = _mode_ctx(discussion)
    raw = _complete(
        provider_factory,
        _moderator_model(personas),
        system=prompts.DEVIL_SYSTEM,
        prompt=prompts.devil_prompt(
            discussion.question,
            personas,
            DEVIL,
            discussion.best_solution or {},
            messages,
            mode=mode,
            options=options,
            rounds=discussion.rounds,
        ),
    )
    devil_review = parse_json(
        raw,
        fallback={
            'verdict': raw[:300] or 'Не вдалося отримати відповідь AI Devil',
            'risks': [],
            'weak_spots': [],
            'counter_arguments': [],
        },
    )
    discussion.devil_review = devil_review
    discussion.save(update_fields=['devil_review', 'updated_at'])

    message = _add_message(
        discussion,
        persona=DEVIL,
        role=Message.Role.DEVIL,
        phase=Discussion.Phase.DEVIL,
        content=_devil_text(devil_review),
    )
    _move_to(discussion, phase=Discussion.Phase.FINAL)
    return message


def _step_final(discussion, provider_factory):
    personas = _resolved_personas(discussion)
    messages = _list_messages(discussion)
    mode, options = _mode_ctx(discussion)
    raw = _complete(
        provider_factory,
        _moderator_model(personas),
        system=prompts.MODERATOR_SYSTEM,
        prompt=prompts.final_prompt(
            discussion.question,
            personas,
            MODERATOR,
            discussion.best_solution or {},
            discussion.devil_review or {},
            messages,
            mode=mode,
            options=options,
            rounds=discussion.rounds,
        ),
    )
    final_summary = parse_json(
        raw,
        fallback={
            'decision': (discussion.best_solution or {}).get('decision', ''),
            'confirmed': True,
            'revision': '',
            'pros': [],
            'cons': [],
            'risks': [],
            'confidence': 0,
            'recommendation': raw[:500],
        },
    )
    final_summary.setdefault('confirmed', True)
    final_summary.setdefault('revision', '')
    discussion.final_summary = final_summary
    discussion.save(update_fields=['final_summary', 'updated_at'])

    message = _add_message(
        discussion,
        persona=MODERATOR,
        role=Message.Role.MODERATOR,
        phase=Discussion.Phase.FINAL,
        content=_final_text(final_summary),
    )
    _move_to(discussion, phase=Discussion.Phase.DONE, status=Discussion.Status.DONE, finished=True)
    return message
