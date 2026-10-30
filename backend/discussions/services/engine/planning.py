"""Підготовка кроку: які виклики зробити зараз і з якими промптами."""

from __future__ import annotations

from django.conf import settings

from backend.i18n import L

from ...models import Discussion, Message
from ...personas import devil, moderator
from ..attachments import documents_for_prompt
from .. import prompts, search
from .base import DEFAULT_TEMPERATURE, EngineError, JSON_TEMPERATURE, StepPlan, USER_SLUG
from .context import (
    _default_model,
    _judge_models,
    _list_messages,
    _mode_ctx,
    _model_for_persona,
    _notes_since,
    _reply_target,
    _resolved_personas,
    _speaker_order,
    _speakers_done,
)


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
        'profile': discussion.profile,
        'documents': documents_for_prompt(discussion.attachments.all()),
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
