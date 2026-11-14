"""Lease кроку: лише один виконавець на дискусію, навіть із кількох процесів."""

from __future__ import annotations

import logging
import threading
from datetime import timedelta

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

from ...models import Discussion
from .base import EngineBusy, EngineError, MAX_ERROR_DETAIL, MAX_ERROR_PUBLIC, generic_public_error

logger = logging.getLogger(__name__)


class _Heartbeat:
    """Продовжує lease, доки триває довгий крок (повтори, кілька викликів)."""

    def __init__(self, discussion_id, token):
        self.discussion_id = discussion_id
        self.token = token
        self.interval = max(1.0, float(settings.LLM_HEARTBEAT_SECONDS))
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()

    def _run(self):
        touched = False
        try:
            while not self.stop_event.wait(self.interval):
                touched = True
                Discussion.objects.filter(
                    pk=self.discussion_id, advance_token=self.token
                ).update(advance_started_at=timezone.now())
        except Exception:
            logger.exception('Lease heartbeat failed')
        finally:
            if touched:
                connection.close()


def _lease_active(discussion, now=None):
    if not discussion.advance_token:
        return False
    now = now or timezone.now()
    started = discussion.advance_started_at or now
    return started + timedelta(seconds=settings.LLM_ADVANCE_LEASE_SECONDS) > now


def is_running(discussion):
    return _lease_active(discussion)


def _claim(discussion_id, token):
    """Атомарно резервує крок. Повертає свіжий Discussion або None для done."""
    now = timezone.now()
    with transaction.atomic():
        discussion = (
            Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        )
        if discussion is None:
            raise EngineError('Дискусію не знайдено.', code='not_found', retryable=False)
        if discussion.phase == Discussion.Phase.DONE:
            return None
        if _lease_active(discussion, now):
            raise EngineBusy(
                'Дискусія вже обробляється. Зачекайте кілька секунд.',
                code='busy',
            )
        discussion.advance_token = token
        discussion.advance_started_at = now
        discussion.advance_count = (discussion.advance_count or 0) + 1
        discussion.live_token = token
        discussion.live_status = ''
        discussion.live_search = ''
        discussion.live_drafts = []
        discussion.live_swaps = {}
        if discussion.status in {Discussion.Status.NEW, Discussion.Status.FAILED}:
            discussion.status = Discussion.Status.IN_PROGRESS
            discussion.error = ''
            discussion.error_code = ''
            discussion.error_public = ''
        discussion.save(
            update_fields=[
                'advance_token',
                'advance_started_at',
                'advance_count',
                'live_token',
                'live_status',
                'live_search',
                'live_drafts',
                'live_swaps',
                'status',
                'error',
                'error_code',
                'error_public',
                'updated_at',
            ]
        )
        return discussion


def _set_error(discussion, exc):
    discussion.status = Discussion.Status.FAILED
    discussion.error = str(exc.detail or '')[:MAX_ERROR_DETAIL]
    discussion.error_code = exc.code[:32]
    discussion.error_public = (exc.public or generic_public_error())[:MAX_ERROR_PUBLIC]


def _fail(discussion_id, token, exc):
    """Позначає крок failed, але лише якщо lease все ще належить цьому запиту."""
    with transaction.atomic():
        discussion = (
            Discussion.objects.select_for_update().filter(pk=discussion_id).first()
        )
        if discussion is None or discussion.advance_token != token:
            return
        _set_error(discussion, exc)
        discussion.advance_token = None
        discussion.advance_started_at = None
        discussion.save(
            update_fields=[
                'status',
                'error',
                'error_code',
                'error_public',
                'advance_token',
                'advance_started_at',
                'updated_at',
            ]
        )


def _release(discussion_id, token, **changes):
    """Знімає lease кроку, зберігаючи зміни, якщо крок досі наш."""
    return Discussion.objects.filter(pk=discussion_id, advance_token=token).update(
        advance_token=None, advance_started_at=None, updated_at=timezone.now(), **changes
    )
