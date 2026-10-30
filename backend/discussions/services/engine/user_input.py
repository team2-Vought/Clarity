"""Що робить людина: уточнення під час чи після дискусії, відповіді модератору,
дострокове завершення.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from backend.i18n import L

from ...models import Discussion, Message
from ...personas import moderator
from ..attachments import documents_for_prompt
from .. import prompts, usage
from .base import EngineConflict, EngineError, JSON_TEMPERATURE, StepPlan, USER_SLUG
from .parsing import _text, normalize_clarify
from .context import _judge_models, _mode_ctx, _next_seq, _resolved_personas
from .calls import _complete_json
from .lease import _release

logger = logging.getLogger(__name__)


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
        prompt=prompts.clarify_prompt(
            discussion.question,
            mode,
            options,
            profile=discussion.profile,
            documents=documents_for_prompt(discussion.attachments.all()),
        ),
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
