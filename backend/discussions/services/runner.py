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

Де виконуються кроки, задає DISCUSSION_RUNNER:
- `thread` (типово, для розробки) — потік у процесі вебсервера; перезапуск
  сервера обриває дискусію, доки клієнт не попросить запустити її знову;
- `worker` (продакшн) — окремий процес `manage.py discussion_worker`. Вебсервер
  лише ставить позначку `run_requested_at`, воркер її підхоплює. Позначка
  живе в базі, тож дискусії, перервані перезапуском, воркер продовжує сам.
"""

import logging
import threading
import time

from django.conf import settings
from django.db import connection
from django.utils import timezone

from backend.i18n import using

from ..models import Discussion
from . import engine, usage
from .catalog import user_context

logger = logging.getLogger(__name__)

MAX_STEPS = 200

_active = set()
_active_lock = threading.Lock()


def is_active(discussion_id):
    with _active_lock:
        return str(discussion_id) in _active


def uses_worker():
    return getattr(settings, 'DISCUSSION_RUNNER', 'thread') == 'worker'


def is_working(discussion):
    """Чи виконується крок. Після «Зупинити» потік, що ще чекає на модель,
    не рахується: lease з нього знято, тож його результат буде відкинуто.
    Питання модератора вже збережені, поки потік ще завершується, — тоді
    дискусія чекає на людину, а не працює."""
    if discussion.awaiting_clarification:
        return False
    if engine.is_running(discussion):
        return True
    if discussion.stop_requested:
        return False
    if uses_worker():
        # між кроками lease знято, але позначка каже, що воркер продовжить
        return discussion.run_requested_at is not None and not discussion.is_finished
    return is_active(discussion.pk)


def daily_usage(user):
    """Скільки AI-відповідей (учасники, модератор, Devil, пошук) створено сьогодні."""
    return usage.today(user).replies


def over_daily_limit(user, discussion=None):
    """Ліміт AI-відповідей вичерпано. Дискусія лише на власних ключах людини
    в ліміт не впирається: за її виклики платить сама людина."""
    if not usage.over_reply_limit(user):
        return False
    if discussion is None:
        return True
    with user_context(user):
        return engine.billing(discussion) != engine.context.OWN


def daily_limit_message():
    return usage.reply_limit_message()


def _fail_with_limit(discussion):
    with using(discussion.language):
        message = daily_limit_message()
    Discussion.objects.filter(pk=discussion.pk).update(
        status=Discussion.Status.FAILED,
        error_code='daily_limit',
        error_public=message,
    )


def run(discussion_id, provider_factory=None, should_stop=None):
    """Виконує кроки, доки дискусія не завершиться, не зупиниться чи не впаде.

    `should_stop` — перевірка між кроками: воркер, що вимикається, доробляє
    поточний крок і не починає наступного."""
    retries = 0
    max_retries = int(settings.DISCUSSION_RUNNER_MAX_RETRIES)
    for _ in range(MAX_STEPS):
        if should_stop is not None and should_stop():
            return
        discussion = Discussion.objects.select_related('user').filter(pk=discussion_id).first()
        if discussion is None or discussion.phase == Discussion.Phase.DONE:
            return
        if discussion.stop_requested or discussion.awaiting_clarification:
            return
        if over_daily_limit(discussion.user, discussion):
            _fail_with_limit(discussion)
            return
        try:
            # моделі викликаються з власними ключами автора дискусії
            with user_context(discussion.user):
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
    """Запускає раннер, якщо в цьому процесі він ще не працює. Повертає True, якщо запущено.

    У режимі воркера лише ставить дискусію в чергу: крок виконає воркер."""
    if getattr(settings, 'DISCUSSION_RUNNER_SYNC', False):
        run(discussion_id)
        return True
    if uses_worker():
        Discussion.objects.filter(pk=discussion_id).exclude(phase=Discussion.Phase.DONE).update(
            run_requested_at=timezone.now()
        )
        return True
    key = str(discussion_id)
    with _active_lock:
        if key in _active:
            return False
        # потоків у вебсервері не більше DISCUSSION_THREAD_MAX: решта дискусій
        # почекає — інтерфейс попросить запустити їх знову під час опитування
        if len(_active) >= settings.DISCUSSION_THREAD_MAX:
            logger.warning('Discussion thread limit reached', extra={'discussion': key})
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
