"""Движок дискусії: стан-машина, яка робить один крок за виклик.

Фази: opening → debate (N раундів) → synthesis → devil → final → done.
Один крок = одне повідомлення в чаті — фронтенд може малювати їх послідовно.
Після перевірки AI Devil фінальний крок або підтверджує висновок, або переглядає його.
"""

import json
import re

from django.db import transaction
from django.utils import timezone

from ..models import Discussion, Message
from ..personas import DEVIL, MODERATOR, PERSONA_BY_SLUG
from . import prompts
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


def _resolved_personas(discussion):
    """Повертає повні описи персон з урахуванням user-оверайдів (style, temperature)."""
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
        if isinstance(item, dict):
            if item.get('style'):
                persona['style'] = item['style']
            if item.get('temperature') is not None:
                persona['temperature'] = float(item['temperature'])
        resolved.append(persona)
    return resolved


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


def _complete(provider, system, prompt, temperature=DEFAULT_TEMPERATURE):
    try:
        return provider.complete(system=system, prompt=prompt, temperature=temperature)
    except ProviderError as exc:
        raise EngineError(str(exc)) from exc


def _moderator_text(best_solution):
    decision = best_solution.get('decision', 'рішення не визначено')
    reasoning = best_solution.get('reasoning', '')
    args = ' • '.join(best_solution.get('supporting_arguments', [])[:4])
    lines = []
    answer = best_solution.get('answer')
    if answer:
        lines.append(f'Відповідь: {answer}')
    lines.append(f'Пропозиція рішення: {decision}')
    if reasoning:
        lines.append(reasoning)
    if args:
        lines.append(f'Аргументи: {args}')
    return '\n'.join(lines).strip()


def _devil_text(review):
    verdict = review.get('verdict', '')
    risks = review.get('risks', [])
    lines = [verdict]
    for risk in risks:
        title = risk.get('title', '')
        severity = risk.get('severity', '')
        lines.append(f'— {title} ({severity})' if severity else f'— {title}')
    for weak in review.get('weak_spots', [])[:3]:
        lines.append(f'Слабке місце: {weak}')
    for counter in review.get('counter_arguments', [])[:3]:
        lines.append(f'Контраргумент: {counter}')
    return '\n'.join(line for line in lines if line).strip()


def _final_text(summary):
    lines = []
    confirmed = summary.get('confirmed')
    answer = summary.get('answer')
    if answer:
        lines.append(f'Відповідь: {answer}')
    decision = summary.get('decision', '')
    lines.append(f'Фінальне рішення: {decision}')

    if confirmed is False:
        lines.append('Висновок ПЕРЕГЛЯНУТО після перевірки AI Devil.')
        if summary.get('revision'):
            lines.append(f'Що змінилось: {summary["revision"]}')
    else:
        lines.append('Висновок ПІДТВЕРДЖЕНО після перевірки AI Devil.')

    confidence = summary.get('confidence', '—')
    lines.append(f'Впевненість: {confidence}%')
    if summary.get('recommendation'):
        lines.append(f'Що робити далі: {summary["recommendation"]}')
    return '\n'.join(lines).strip()


@transaction.atomic
def advance(discussion):
    """Робить один крок дискусії. Повертає нове Message або None, якщо все готово."""
    if discussion.status == Discussion.Status.FAILED:
        raise EngineError('Дискусію зупинено через помилку')
    if discussion.phase == Discussion.Phase.DONE:
        return None

    provider = get_provider()
    if discussion.status == Discussion.Status.NEW:
        discussion.status = Discussion.Status.IN_PROGRESS
        discussion.save(update_fields=['status', 'updated_at'])

    try:
        message = _step(discussion, provider)
    except EngineError:
        _move_to(discussion, status=Discussion.Status.FAILED)
        raise

    return message


def _step(discussion, provider):
    handler = {
        Discussion.Phase.OPENING: _step_opening,
        Discussion.Phase.DEBATE: _step_debate,
        Discussion.Phase.SYNTHESIS: _step_synthesis,
        Discussion.Phase.DEVIL: _step_devil,
        Discussion.Phase.FINAL: _step_final,
    }.get(discussion.phase)

    if handler is None:
        raise EngineError(f'Невідома фаза: {discussion.phase}')
    return handler(discussion, provider)


def _step_opening(discussion, provider):
    personas = _resolved_personas(discussion)
    persona = personas[discussion.speaker_index]
    mode, options = _mode_ctx(discussion)
    content = _complete(
        provider,
        system=prompts.SYSTEM_BASE,
        prompt=prompts.opening_prompt(
            discussion.question, persona, mode=mode, options=options
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


def _step_debate(discussion, provider):
    personas = _resolved_personas(discussion)
    persona = personas[discussion.speaker_index]
    mode, options = _mode_ctx(discussion)
    content = _complete(
        provider,
        system=prompts.SYSTEM_BASE,
        prompt=prompts.debate_prompt(
            discussion.question,
            persona,
            _list_messages(discussion),
            discussion.current_round,
            mode=mode,
            options=options,
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


def _step_synthesis(discussion, provider):
    messages = _list_messages(discussion)
    mode, options = _mode_ctx(discussion)
    raw = _complete(
        provider,
        system=prompts.MODERATOR_SYSTEM,
        prompt=prompts.synthesis_prompt(
            discussion.question, messages, mode=mode, options=options
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


def _step_devil(discussion, provider):
    messages = _list_messages(discussion)
    mode, options = _mode_ctx(discussion)
    raw = _complete(
        provider,
        system=prompts.DEVIL_SYSTEM,
        prompt=prompts.devil_prompt(
            discussion.question,
            discussion.best_solution or {},
            messages,
            mode=mode,
            options=options,
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


def _step_final(discussion, provider):
    messages = _list_messages(discussion)
    mode, options = _mode_ctx(discussion)
    raw = _complete(
        provider,
        system=prompts.MODERATOR_SYSTEM,
        prompt=prompts.final_prompt(
            discussion.question,
            discussion.best_solution or {},
            discussion.devil_review or {},
            messages,
            mode=mode,
            options=options,
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
