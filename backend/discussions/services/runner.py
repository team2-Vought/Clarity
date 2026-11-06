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
from datetime import timedelta

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


# ---------- дерево рішень ----------
# Модель може думати хвилинами (повтори, запасні моделі), тож дерево
# складається у фоновому потоці вебсервера, а вікно опитує стан. Перезапуск
# сервера обриває побудову — тоді «складається» без руху довше за TREE_STALE,
# і людина може запустити її знову.

# пульс раз на TREE_HEARTBEAT_SECONDS; без пульсу довше за TREE_STALE_SECONDS —
# потік загинув разом із процесом (перезапуск, деплой)
TREE_HEARTBEAT_SECONDS = 10
TREE_STALE_SECONDS = 60


def tree_is_building(discussion):
    alive = discussion.tree_heartbeat_at or discussion.tree_started_at
    return (
        discussion.tree_state == 'building'
        and alive is not None
        and (timezone.now() - alive).total_seconds() < TREE_STALE_SECONDS
    )


class _TreePulse(threading.Thread):
    """Поки модель думає, раз на кілька секунд позначає побудову живою."""

    def __init__(self, discussion_id, started):
        super().__init__(name=f'tree-pulse-{str(discussion_id)[:8]}', daemon=True)
        self.discussion_id = discussion_id
        self.started = started
        self.done = threading.Event()

    def run(self):
        try:
            while not self.done.wait(TREE_HEARTBEAT_SECONDS):
                Discussion.objects.filter(
                    pk=self.discussion_id, tree_state='building', tree_started_at=self.started
                ).update(tree_heartbeat_at=timezone.now())
        finally:
            connection.close()


def _tree_failed(discussion_id, started, public):
    Discussion.objects.filter(pk=discussion_id, tree_state='building', tree_started_at=started).update(
        tree_state='error', tree_error=(public or '')[:300], tree_started_at=None, tree_heartbeat_at=None
    )


def run_tree(discussion_id, provider_factory=None):
    discussion = Discussion.objects.select_related('user').filter(pk=discussion_id).first()
    if discussion is None:
        return
    # усі оновлення стану — лише для цього запуску (див. tree_started_at)
    started = discussion.tree_started_at
    pulse = None
    if not getattr(settings, 'DISCUSSION_RUNNER_SYNC', False):
        pulse = _TreePulse(discussion_id, started)
        pulse.start()
    try:
        with user_context(discussion.user):
            engine.build_tree(discussion, provider_factory=provider_factory)
    except engine.EngineConflict:
        # висновок змінився — це дерево вже нікому не потрібне
        Discussion.objects.filter(pk=discussion_id, tree_started_at=started).update(
            tree_state='', tree_error='', tree_started_at=None, tree_heartbeat_at=None
        )
    except engine.EngineError as exc:
        logger.warning('Decision tree failed', extra={'discussion': str(discussion_id), 'error': exc.detail})
        with using(discussion.language):
            _tree_failed(discussion_id, started, exc.public or engine.generic_public_error())
    except Exception:
        logger.exception('Decision tree crashed', extra={'discussion': str(discussion_id)})
        with using(discussion.language):
            _tree_failed(discussion_id, started, engine.generic_public_error())
    finally:
        if pulse is not None:
            pulse.done.set()


def _run_tree_in_thread(discussion_id):
    try:
        run_tree(discussion_id)
    finally:
        connection.close()


def start_tree(discussion):
    """Позначає, що дерево складається, і запускає побудову. False — воно вже
    складається (повторний клік, друга вкладка): модель удруге не кличемо."""
    now = timezone.now()
    stale = now - timedelta(seconds=TREE_STALE_SECONDS)
    claimed = (
        Discussion.objects.filter(pk=discussion.pk, phase=Discussion.Phase.DONE)
        .exclude(tree_state='building', tree_heartbeat_at__gt=stale)
        .update(tree_state='building', tree_error='', tree_started_at=now, tree_heartbeat_at=now)
    )
    if not claimed:
        return False
    if getattr(settings, 'DISCUSSION_RUNNER_SYNC', False):
        run_tree(discussion.pk)
        return True
    threading.Thread(
        target=_run_tree_in_thread,
        args=(discussion.pk,),
        name=f'tree-{str(discussion.pk)[:8]}',
        daemon=True,
    ).start()
    return True
