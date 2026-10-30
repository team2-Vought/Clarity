"""Воркер дискусій: виконує кроки поза вебсервером (DISCUSSION_RUNNER=worker).

Вебсервер лише ставить позначку `run_requested_at`; воркер опитує базу,
бере дискусії з позначкою, чий lease вільний, і веде кожну у власному потоці,
доки вона не завершиться, не зупиниться чи не почне чекати на людину.

Позначка живе в базі, тож після перезапуску чи падіння воркера дискусії
продовжаться самі: перерваний крок звільниться, щойно сплине його lease.
Кілька воркерів поруч не заважають один одному — крок серіалізує lease.
"""

import logging
import signal
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection
from django.db.models import Q
from django.utils import timezone

from discussions.models import Discussion
from discussions.services import engine, runner

logger = logging.getLogger(__name__)


def due_discussions(exclude=(), limit=1):
    """Дискусії в черзі, яких зараз ніхто не виконує, — найстаріші запити першими."""
    stale = timezone.now() - timedelta(seconds=settings.LLM_ADVANCE_LEASE_SECONDS)
    return list(
        Discussion.objects.filter(run_requested_at__isnull=False, stop_requested=False)
        .exclude(phase=Discussion.Phase.DONE)
        .exclude(pk__in=list(exclude))
        .filter(Q(advance_token__isnull=True) | Q(advance_started_at__lt=stale))
        .order_by('run_requested_at')
        .values_list('pk', 'run_requested_at')[:limit]
    )


def settled(discussion):
    """Дискусія більше не потребує воркера, доки її знову не запустять."""
    return (
        discussion.is_finished
        or discussion.stop_requested
        or discussion.awaiting_clarification
        or discussion.status == Discussion.Status.FAILED
    )


def work(discussion_id, requested_at, should_stop=None):
    """Веде одну дискусію; знімає позначку, лише якщо її не оновили тим часом
    (людина могла дописати уточнення — тоді дискусію треба вести далі)."""
    try:
        runner.run(discussion_id, should_stop=should_stop)
        discussion = Discussion.objects.filter(pk=discussion_id).first()
        if discussion is not None and settled(discussion) and not engine.is_running(discussion):
            Discussion.objects.filter(pk=discussion_id, run_requested_at=requested_at).update(
                run_requested_at=None
            )
    except Exception:
        logger.exception('Discussion worker failed', extra={'discussion': str(discussion_id)})


def _work_in_thread(*args):
    try:
        work(*args)
    finally:
        # у кожного потоку пулу своє з'єднання — не тримаємо його між дискусіями
        connection.close()


class Command(BaseCommand):
    help = 'Виконує дискусії з черги (DISCUSSION_RUNNER=worker).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--concurrency',
            type=int,
            default=settings.DISCUSSION_WORKER_CONCURRENCY,
            help='Скільки дискусій вести одночасно.',
        )
        parser.add_argument(
            '--poll',
            type=float,
            default=settings.DISCUSSION_WORKER_POLL_SECONDS,
            help='Пауза між перевірками черги, секунд.',
        )
        parser.add_argument(
            '--once',
            action='store_true',
            help='Виконати те, що вже в черзі, і вийти.',
        )

    def handle(self, *args, concurrency, poll, once, **options):
        concurrency = max(1, concurrency)
        stopping = threading.Event()

        def request_stop(signum, frame):
            # поточні кроки доробляються, нових не беремо; позначки лишаються в базі
            self.stdout.write('Stopping after the current steps…')
            stopping.set()

        if threading.current_thread() is threading.main_thread():
            signal.signal(signal.SIGTERM, request_stop)
            signal.signal(signal.SIGINT, request_stop)

        if settings.DISCUSSION_RUNNER != 'worker':
            self.stderr.write(
                'DISCUSSION_RUNNER is not "worker": the web server runs discussions itself '
                'and will not queue them for this worker.'
            )
        self.stdout.write(f'Discussion worker started (concurrency {concurrency}).')

        running = {}
        with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix='discussion') as pool:
            while not stopping.is_set():
                for pk in [pk for pk, future in running.items() if future.done()]:
                    running.pop(pk)
                free = concurrency - len(running)
                if free > 0:
                    for pk, requested_at in due_discussions(exclude=running, limit=free):
                        running[pk] = pool.submit(_work_in_thread, pk, requested_at, stopping.is_set)
                if once and not running:
                    break
                stopping.wait(poll)
        self.stdout.write('Discussion worker stopped.')
