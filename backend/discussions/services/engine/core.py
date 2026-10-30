"""Крок дискусії: lease → виклики моделей → атомарне збереження й перехід фази."""

from __future__ import annotations

import logging
import uuid

from django.db import transaction
from django.utils import timezone

from backend.i18n import L, using

from ...models import Discussion, Message
from ...personas import devil, moderator
from .. import usage
from ..criteria import compute_matrix
from ..safety import CRISIS, crisis_message
from .base import EngineBusy, EngineConflict, EngineError, STANCE_AGREE
from .context import _add_message, _list_messages, _resolved_personas, _speakers_done
from .live import _DraftBoard, _drafts, _live
from .calls import _run_plans
from .planning import _prepare_step
from .status import _start_ai_status
from .texts import _agreement, _devil_text, _final_text, _merge_sources, _moderator_text
from .lease import _Heartbeat, _claim, _fail, _set_error
from .user_input import _clarify_step

logger = logging.getLogger(__name__)


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
    _after_debate(discussion)


def _uses_criteria(discussion):
    return bool(discussion.criteria) and discussion.mode == Discussion.Mode.CHOOSE_ONE


def _after_debate(discussion):
    """Після дебатів — оцінка за критеріями людини, якщо вона їх задала, інакше рішення."""
    if _uses_criteria(discussion):
        discussion.phase = Discussion.Phase.SCORING
        discussion.scores = {}
    else:
        discussion.phase = Discussion.Phase.SYNTHESIS


def _all_spoke(discussion, personas, phase):
    done = _speakers_done(_list_messages(discussion), phase)
    return all(persona['slug'] in done for persona in personas)


def _store(discussion, plan, payload, personas):
    """Зберігає результат виклику; None — крок без повідомлення в чаті (оцінки)."""
    if plan.phase == Discussion.Phase.SCORING:
        discussion.scores = {**(discussion.scores or {}), plan.persona['slug']: payload}
        return None
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
    elif plan.phase == Discussion.Phase.QUICK:
        topic = payload.pop('topic', '')
        if topic:
            discussion.safety = topic
        if topic == CRISIS:
            # криза — не порада, а підтримка й контакти допомоги
            discussion.final_summary = None
            content = crisis_message()
        else:
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
    elif phase == Discussion.Phase.SCORING:
        if all(persona['slug'] in (discussion.scores or {}) for persona in personas):
            discussion.matrix = compute_matrix(discussion.criteria, discussion.options, discussion.scores)
            discussion.phase = Discussion.Phase.SYNTHESIS
    elif phase in {Discussion.Phase.FINAL, Discussion.Phase.QUICK}:
        discussion.phase = Discussion.Phase.DONE
        discussion.status = Discussion.Status.DONE
        discussion.finished_at = timezone.now()
    elif phase == Discussion.Phase.ANSWER:
        # відповідь одного учасника не переписує висновку — дискусія знову завершена
        discussion.phase = Discussion.Phase.DONE
        discussion.status = Discussion.Status.DONE
        discussion.ask_target = ''
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
        stored = [_store(discussion, plan, payload, personas) for plan, payload in results]
        # оцінки за критеріями — теж відповіді моделей, хоч і без повідомлень у чаті
        usage.record(discussion.user_id, replies=len(stored))
        created = [message for message in stored if message is not None]
        if error is not None:
            _set_error(discussion, error)
        else:
            _transition(discussion, personas)
            discussion.error = ''
            discussion.error_code = ''
            discussion.error_public = ''

        discussion.advance_token = None
        discussion.advance_started_at = None
        # репліки збережено — чернетки, з яких вони виросли, більше не потрібні
        discussion.live_drafts = []
        discussion.save()
        return created


def _crisis_stop(discussion_id, token):
    """Криза: замість дискусії — підтримка модератора; контакти допомоги показує інтерфейс.

    Жодного виклику моделі: відповідь однакова й надійна, навіть без ключів."""
    with transaction.atomic():
        discussion = Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        if discussion is None or discussion.advance_token != token:
            raise EngineConflict('Дискусію вже оновив інший запит.', code='conflict')
        message = _add_message(
            discussion,
            persona=moderator(),
            role=Message.Role.MODERATOR,
            # не «фінальний висновок»: це підтримка, тож у чаті без роздільника етапу
            phase=Discussion.Phase.CLARIFY,
            content=crisis_message(),
        )
        discussion.safety = CRISIS
        discussion.phase = Discussion.Phase.DONE
        discussion.status = Discussion.Status.DONE
        discussion.finished_at = timezone.now()
        discussion.final_summary = None
        discussion.advance_token = None
        discussion.advance_started_at = None
        discussion.live_drafts = []
        discussion.save()
        return [message]


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
    drafts = _drafts.set(_DraftBoard(discussion_id, token))
    try:
        if claimed.safety == CRISIS:
            return _crisis_stop(discussion_id, token)
        if claimed.phase == Discussion.Phase.CLARIFY:
            _start_ai_status(claimed, provider_factory)
            outcome = _clarify_step(claimed, token, provider_factory)
            if outcome == CRISIS:
                return _crisis_stop(discussion_id, token)
            if not outcome:
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
        _drafts.reset(drafts)
        _live.reset(live)
        heartbeat.stop()
