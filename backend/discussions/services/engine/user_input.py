"""Що робить людина: уточнення під час чи після дискусії, відповіді модератору,
дострокове завершення.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from backend.i18n import L

from ...models import Attachment, Discussion, Message
from ...personas import moderator
from ..attachments import documents_for_prompt
from .. import prompts, usage
from ..safety import CRISIS, looks_like_crisis
from .base import EngineConflict, EngineError, JSON_TEMPERATURE, StepPlan, USER_SLUG, daily_limit_error
from .parsing import _text, normalize_clarify
from .context import _judge_models, _mode_ctx, _next_seq, _resolved_personas
from .calls import _complete_json
from .lease import _release
from .status import _start_ai_status

logger = logging.getLogger(__name__)


def _not_found():
    return L('Дискусію не знайдено.', 'Discussion not found.')


def add_user_message(discussion_id, author_name, content, target='', quick=False, attachment_ids=()):
    """Додає уточнення користувача.

    Під час дискусії воно потрапляє в історію, і наступні учасники на нього
    реагують. Після фіналу — відкриває ще один раунд дебатів, після якого
    синтез, перевірка Devil і фінал проходять заново; у швидкому режимі —
    ще одну коротку відповідь. Якщо після фіналу людина звертається до одного
    учасника (`target` — його slug), відповідає лише він, а висновок лишається.
    `quick` після фіналу просить коротку відповідь модератора замість раунду.
    `attachment_ids` — файли, щойно завантажені для цього уточнення: вони
    стають частиною дискусії, і наступні кроки бачать їх у промптах.
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
        attachment_ids = list(dict.fromkeys(attachment_ids or ()))
        if attachment_ids:
            limit = int(settings.ATTACHMENTS_TOTAL_MAX)
            if discussion.attachments.count() + len(attachment_ids) > limit:
                raise EngineError(
                    'Ліміт файлів дискусії вичерпано.',
                    code='attachments_limit',
                    public=L(
                        f'До однієї дискусії можна додати не більше {limit} файлів.',
                        f'You can add no more than {limit} files to one discussion.',
                    ),
                    retryable=False,
                )
        if discussion.safety == CRISIS or looks_like_crisis(content):
            # криза посеред розмови — наступний крок зупиняє дискусію й показує допомогу
            discussion.safety = CRISIS
        reopened = discussion.phase == Discussion.Phase.DONE
        persona = None
        if target:
            persona = next(
                (p for p in _resolved_personas(discussion) if p['slug'] == target), None
            )
            if not reopened or persona is None:
                raise EngineError(
                    'Звернутися до учасника можна лише після висновку.',
                    code='bad_target',
                    public=L(
                        'Звернутися до окремого учасника можна після висновку.',
                        'You can address a single participant after the conclusion.',
                    ),
                    retryable=False,
                )
            limit = int(settings.DISCUSSION_MAX_DIRECT)
            if discussion.direct_questions >= limit:
                raise EngineError(
                    'Ліміт питань учасникам вичерпано.',
                    code='direct_limit',
                    public=L(
                        f'До окремих учасників можна звернутися не більше {limit} разів. '
                        'Створіть нову дискусію.',
                        f'You can address single participants no more than {limit} times. '
                        'Start a new discussion.',
                    ),
                    retryable=False,
                )
            discussion.direct_questions += 1
            discussion.ask_target = persona['slug']
            discussion.phase = Discussion.Phase.ANSWER
            discussion.status = Discussion.Status.IN_PROGRESS
        elif reopened:
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
            discussion.finished_early = False
            discussion.status = Discussion.Status.IN_PROGRESS
            discussion.finished_at = None
            if discussion.quick or quick:
                # у швидкому режимі (або на прохання людини) уточнення — це ще одна коротка відповідь
                discussion.phase = Discussion.Phase.QUICK
            else:
                discussion.current_round += 1
                discussion.rounds = discussion.current_round
                discussion.speaker_index = 0
                discussion.early_stop = False
                discussion.phase = Discussion.Phase.DEBATE
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
            # питання до одного учасника — у чаті видно, до кого саме
            reply_to=persona['name'] if persona else '',
            reply_to_slug=persona['slug'] if persona else '',
        )
        if attachment_ids:
            Attachment.objects.filter(
                user_id=discussion.user_id, pk__in=attachment_ids, discussion__isnull=True
            ).update(discussion=discussion, message=message)
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
    CRISIS — модератор розпізнав кризу: дискусію треба зупинити.
    """
    if discussion.clarify_questions:
        _release(discussion.pk, token)
        return False
    if not usage.reserve_replies(discussion.user_id, 1):
        raise daily_limit_error()
    _start_ai_status(discussion, provider_factory)
    try:
        result = clarify(discussion, provider_factory)
    except EngineError:
        usage.release_replies(discussion.user_id, 1)
        logger.warning('Context check failed', extra={'discussion': str(discussion.pk)}, exc_info=True)
        result = {'ready': True, 'questions': []}
    if result.get('topic'):
        Discussion.objects.filter(pk=discussion.pk, advance_token=token).update(safety=result['topic'])
        if result['topic'] == CRISIS:
            # криза — без питань і без дебатів; lease лишається за кроком
            return CRISIS
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
