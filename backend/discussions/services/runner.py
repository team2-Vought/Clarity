"""Фоновий запуск дискусії на сервері.

Раніше дискусію крок за кроком «штовхав» браузер: кожен крок був довгим
HTTP-запитом, закрита вкладка зупиняла дебати, а дві вкладки конфліктували.
Тепер браузер лише просить запустити дискусію (POST /run) і опитує стан
(GET ?after=seq), а кроки виконує фоновий потік:

- між кроками перевіряється `stop_requested` — «Зупинити» завершує поточний
  крок (за нього вже заплачено) і не починає наступний;
- тимчасові збої моделей повторюються з паузою, помилки налаштування
  (ключ, недоступна модель) — ні;
- паралельні раннери однієї дискусії не шкодять: кроки серіалізує lease.
"""

import logging
import threading
import time

from django.conf import settings
from django.db import connection

from ..models import Discussion
from . import engine, usage

logger = logging.getLogger(__name__)

MAX_STEPS = 200

_active = set()
_active_lock = threading.Lock()


def is_active(discussion_id):
    with _active_lock:
        return str(discussion_id) in _active


def daily_usage(user):
    """Скільки AI-відповідей (учасники, модератор, Devil, пошук) створено сьогодні."""
    return usage.today(user).replies


def over_daily_limit(user):
    return usage.over_reply_limit(user)


def _fail_with_limit(discussion_id):
    limit = int(getattr(settings, 'DISCUSSION_DAILY_ADVANCE_LIMIT', 0) or 0)
    Discussion.objects.filter(pk=discussion_id).update(
        status=Discussion.Status.FAILED,
        error_code='daily_limit',
        error_public=f'Денний ліміт AI-відповідей вичерпано ({limit}). Спробуйте завтра.',
    )


def run(discussion_id, provider_factory=None):
    """Виконує кроки, доки дискусія не завершиться, не зупиниться чи не впаде."""
    retries = 0
    max_retries = int(settings.DISCUSSION_RUNNER_MAX_RETRIES)
    for _ in range(MAX_STEPS):
        discussion = Discussion.objects.select_related('user').filter(pk=discussion_id).first()
        if discussion is None or discussion.phase == Discussion.Phase.DONE:
            return
        if discussion.stop_requested:
            return
        if over_daily_limit(discussion.user):
            _fail_with_limit(discussion_id)
            return
        try:
            engine.advance(discussion, provider_factory=provider_factory)
        except engine.EngineBusy:
            # крок виконує інший раннер (інший процес чи вкладка) — він і продовжить
            return
        except engine.EngineConflict:
            continue
        except engine.EngineError as exc:
            if not exc.retryable or retries >= max_retries:
                return
            retries += 1
            delay = float(settings.DISCUSSION_RUNNER_RETRY_DELAY_SECONDS) * retries
            logger.info(
                'Retrying failed discussion step',
                extra={'discussion': str(discussion_id), 'attempt': retries, 'delay': delay},
            )
            time.sleep(delay)
            continue
        retries = 0


def _run_in_thread(discussion_id):
    key = str(discussion_id)
    try:
        run(discussion_id)
    except Exception:
        logger.exception('Discussion runner crashed', extra={'discussion': key})
    finally:
        with _active_lock:
            _active.discard(key)
        connection.close()


def start(discussion_id):
    """Запускає раннер, якщо в цьому процесі він ще не працює. Повертає True, якщо запущено."""
    if getattr(settings, 'DISCUSSION_RUNNER_SYNC', False):
        run(discussion_id)
        return True
    key = str(discussion_id)
    with _active_lock:
        if key in _active:
            return False
        _active.add(key)
    thread = threading.Thread(
        target=_run_in_thread,
        args=(discussion_id,),
        name=f'discussion-{key[:8]}',
        daemon=True,
    )
    thread.start()
    return True
