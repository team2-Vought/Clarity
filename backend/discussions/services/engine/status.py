"""Що зараз роблять AI: рядки для індикатора «Аналізуємо…» й короткий статус від моделі."""

from __future__ import annotations

import contextvars
import logging
import threading

from django.conf import settings
from django.db import connection

from backend.i18n import L, using

from ...models import Discussion, Message
from ...personas import devil, moderator
from .. import prompts, usage
from ..catalog import paid_by_user
from .context import (
    _default_model,
    _judge_models,
    _list_messages,
    _mode_ctx,
    _reply_target,
    _resolved_personas,
    _speaker_order,
    _speakers_done,
)
from .live import _live, _set_live, clean_status
from .calls import _complete

logger = logging.getLogger(__name__)


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

# Що відбувається на етапі — контекст для моделі, яка пише рядок статусу
STAGE_NOTES = {
    Discussion.Phase.CLARIFY: 'модератор перевіряє, чи вистачає контексту',
    Discussion.Phase.OPENING: 'учасники формують перші позиції',
    Discussion.Phase.DEBATE: 'учасники по черзі сперечаються',
    Discussion.Phase.SCORING: 'учасники оцінюють варіанти за критеріями людини',
    Discussion.Phase.QUICK: 'модератор готує коротку відповідь',
    Discussion.Phase.ANSWER: 'учасник відповідає на питання людини',
    Discussion.Phase.SYNTHESIS: 'модератор зводить аргументи в рішення',
    Discussion.Phase.DEVIL: 'AI Devil шукає слабкі місця рішення',
    Discussion.Phase.REBUTTAL: 'учасники відповідають на критику',
    Discussion.Phase.FINAL: 'модератор формулює фінальний висновок',
}

STAGE_NOTES_EN = {
    Discussion.Phase.CLARIFY: 'the moderator checks whether there is enough context',
    Discussion.Phase.OPENING: 'the participants form their first positions',
    Discussion.Phase.DEBATE: 'the participants take turns arguing',
    Discussion.Phase.SCORING: 'the participants score the options on the person’s criteria',
    Discussion.Phase.QUICK: 'the moderator prepares a short answer',
    Discussion.Phase.ANSWER: 'a participant answers the person’s question',
    Discussion.Phase.SYNTHESIS: 'the moderator brings the arguments together into a solution',
    Discussion.Phase.DEVIL: 'AI Devil looks for weak spots in the solution',
    Discussion.Phase.REBUTTAL: 'the participants respond to the criticism',
    Discussion.Phase.FINAL: 'the moderator formulates the final conclusion',
}


def _status_model(discussion):
    personas = _resolved_personas(discussion)
    return (_judge_models(discussion, personas, 'moderator') or [_default_model()])[0]


def _write_ai_status(discussion, focus, provider_factory, model_id, billed):
    try:
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
        if billed:
            usage.release_replies(discussion.user_id, 1)
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
    # статус — теж виклик моделі; за рахунок сервера він рахується в ліміт,
    # а не вміщується — обходимось без нього. Власним ключем людини — без ліміту
    model_id = _status_model(discussion)
    billed = not paid_by_user(model_id)
    if billed and not usage.reserve_replies(discussion.user_id, 1):
        return
    _set_live(live_status='')
    context = contextvars.copy_context()
    threading.Thread(
        target=context.run,
        args=(_write_ai_status, discussion, focus, provider_factory, model_id, billed),
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

    if phase == Discussion.Phase.QUICK:
        return [_focus(moderator(), L('готує коротку відповідь', 'prepares a short answer'))]

    if phase == Discussion.Phase.ANSWER:
        persona = next((p for p in personas if p['slug'] == discussion.ask_target), None)
        return [_focus(persona, L('відповідає на ваше питання', 'answers your question'))] if persona else []

    if phase == Discussion.Phase.SCORING:
        scored = discussion.scores or {}
        return [
            _focus(persona, L('оцінює варіанти за вашими критеріями', 'scores the options on your criteria'))
            for persona in personas
            if persona['slug'] not in scored
        ]

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
