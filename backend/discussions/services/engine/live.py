"""Живий стан кроку для інтерфейсу: рядок статусу, пошуковий запит і чернетки реплік.

Усе це прив'язано до lease-токена кроку: після кроку чи «Зупинити» записи
нічого не змінюють, тож застарілий статус не «залипає».
"""

from __future__ import annotations

import contextvars
import logging
import re
import threading
import time

from ...models import Discussion

logger = logging.getLogger(__name__)


STATUS_LIMIT = 70
_THINK_RE = re.compile(r'<think>.*?(</think>|$)', re.IGNORECASE | re.DOTALL)

# Крок, якому належать записи живого статусу: (discussion_id, advance_token)
_live = contextvars.ContextVar('discussion_live', default=None)


def _set_live(phase=None, **fields):
    """Оновлює живий статус поточного кроку; після кроку запис нічого не змінює.

    `phase` — записати, лише якщо дискусія досі в цій фазі: уточнення й вступ
    ідуть одним кроком, і запізнілий статус уточнення не має перекрити вступ.
    """
    live = _live.get()
    if live is None:
        return
    discussion_id, token = live
    scope = {'phase': phase} if phase else {}
    try:
        Discussion.objects.filter(pk=discussion_id, advance_token=token, **scope).update(**fields)
    except Exception as exc:
        # статус — лише підказка інтерфейсу: крок не має падати через нього
        logger.warning('Live status update failed', extra={'error': str(exc)})


# Чернетки реплік, які моделі ще пишуть. Записуються не частіше за цей
# інтервал: клієнт опитує раз на ~0,7 с, частіші записи лише навантажили б базу.
DRAFT_FLUSH_SECONDS = 0.35
_DRAFT_SERVICE_RE = re.compile(
    r'^[ \t>*_#\-]*(ТЕЗА|ПОЗИЦІЯ|ПОШУК|THESIS|STANCE|SEARCH)[ \t*_]*:',
    re.IGNORECASE | re.MULTILINE,
)
_SERVICE_WORDS = ('ТЕЗА', 'ПОЗИЦІЯ', 'ПОШУК', 'THESIS', 'STANCE', 'SEARCH')


def draft_text(raw):
    """Текст недописаної репліки для показу: без роздумів моделі й службових
    рядків наприкінці — зокрема рядка, що ще друкується («ТЕЗ…»)."""
    text = _THINK_RE.sub('', str(raw or '')).replace('\r\n', '\n')
    match = _DRAFT_SERVICE_RE.search(text)
    if match:
        text = text[: match.start()]
    head, _, tail = text.rpartition('\n')
    fragment = tail.strip(' \t>*_#-')
    if fragment and fragment.isupper() and any(
        word.startswith(fragment.upper()) for word in _SERVICE_WORDS
    ):
        text = head
    return text.strip()


class _DraftBoard:
    """Чернетки одного кроку: по одній на учасника, що зараз пише.

    Паралельні виклики (вступ, відповідь на Devil) пишуть сюди з різних
    потоків; у базу йде знімок усіх чернеток, тож вони не затирають одна одну.
    Запис прив'язаний до lease-токена — після кроку чи «Зупинити» він нічого
    не змінює.
    """

    def __init__(self, discussion_id, token):
        self.discussion_id = discussion_id
        self.token = token
        self.lock = threading.Lock()
        self.drafts = {}
        self.flushed_at = 0.0

    def update(self, plan, raw):
        text = draft_text(raw)
        persona = plan.persona
        with self.lock:
            entry = self.drafts.setdefault(
                persona['slug'],
                {
                    'slug': persona['slug'],
                    'name': persona['name'],
                    'phase': plan.phase,
                    'round': plan.debate_round,
                    'reply_to': plan.reply_to,
                    'reply_to_slug': plan.reply_to_slug,
                    'text': '',
                },
            )
            if entry['text'] == text:
                return
            entry['text'] = text
            now = time.monotonic()
            # порожній текст (потік обірвався й почнеться знову) — записуємо одразу
            if text and now - self.flushed_at < DRAFT_FLUSH_SECONDS:
                return
            self.flushed_at = now
            snapshot = [dict(item) for item in self.drafts.values()]
        try:
            Discussion.objects.filter(
                pk=self.discussion_id, advance_token=self.token
            ).update(live_drafts=snapshot)
        except Exception as exc:
            # чернетка — лише підказка інтерфейсу: крок не має падати через неї
            logger.warning('Draft update failed', extra={'error': str(exc)})


# Дошка чернеток поточного кроку; потоки паралельних викликів отримують її копією контексту
_drafts = contextvars.ContextVar('discussion_drafts', default=None)


def clean_status(raw):
    """Перший змістовний рядок відповіді моделі як «Зважуємо ризики…»."""
    text = _THINK_RE.sub('', str(raw or ''))
    line = next((line for line in text.splitlines() if line.strip()), '')
    line = ' '.join(line.split()).strip(' "\'«»*`#>-—.…!')
    if not line:
        return ''
    if len(line) > STATUS_LIMIT:
        line = line[:STATUS_LIMIT].rsplit(' ', 1)[0].rstrip(' ,;:—-')
    return f'{line[:1].upper()}{line[1:]}…'
