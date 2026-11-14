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
from .parsing import strip_echoed_instructions

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
    text = strip_echoed_instructions(text)
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

    Кожна чернетка знає, якою моделлю пишеться, коли почала (`started`, епоха)
    і чи вже готова (`done`) — так інтерфейс чесно показує, хто затримує крок.
    """

    def __init__(self, discussion_id, token):
        self.discussion_id = discussion_id
        self.token = token
        self.lock = threading.Lock()
        self.drafts = {}
        self.flushed_at = 0.0

    def _entry(self, plan):
        persona = plan.persona
        return self.drafts.setdefault(
            persona['slug'],
            {
                'slug': persona['slug'],
                'name': persona['name'],
                'phase': plan.phase,
                'round': plan.debate_round,
                'reply_to': plan.reply_to,
                'reply_to_slug': plan.reply_to_slug,
                'text': '',
                'model': '',
                'started': time.time(),
                'swapped': False,
                'done': False,
            },
        )

    def attempt(self, plan, model_id):
        """Учасник починає писати моделлю `model_id` (знову — якщо попередня
        не відповіла чи її замінили)."""
        with self.lock:
            entry = self._entry(plan)
            if entry['model'] and entry['model'] != model_id:
                entry['swapped'] = True
            entry.update(model=model_id, text='', started=time.time(), done=False)
            snapshot = self._snapshot()
        self._write(snapshot)

    def update(self, plan, raw):
        text = draft_text(raw)
        with self.lock:
            entry = self._entry(plan)
            if entry['text'] == text or entry['done']:
                return
            entry['text'] = text
            now = time.monotonic()
            # порожній текст (потік обірвався й почнеться знову) — записуємо одразу
            if text and now - self.flushed_at < DRAFT_FLUSH_SECONDS:
                return
            snapshot = self._snapshot()
        self._write(snapshot)

    def finish(self, plan, raw):
        """Відповідь готова: записуємо її цілком, навіть якщо останній шматок
        прийшов швидше за інтервал запису, — інакше чернетка «обривалась»."""
        with self.lock:
            entry = self._entry(plan)
            entry.update(text=draft_text(raw), done=True)
            snapshot = self._snapshot()
        self._write(snapshot)

    def cancel_check(self, slug):
        """Функція для сторожа виклику: 'swap' — людина попросила замінити
        модель учасника, 'stopped' — крок зупинили, '' — працюємо далі."""
        baseline = self._swaps()
        if baseline is None:
            return lambda: 'stopped'
        base = baseline.get(slug, 0)

        def check():
            swaps = self._swaps()
            if swaps is None:
                return 'stopped'
            return 'swap' if swaps.get(slug, 0) > base else ''

        return check

    def _swaps(self):
        try:
            row = (
                Discussion.objects.filter(pk=self.discussion_id, advance_token=self.token)
                .values_list('live_swaps', flat=True)
                .first()
            )
        except Exception as exc:
            logger.warning('Swap check failed', extra={'error': str(exc)})
            return {}
        if row is None and not Discussion.objects.filter(
            pk=self.discussion_id, advance_token=self.token
        ).exists():
            return None
        return row if isinstance(row, dict) else {}

    def _snapshot(self):
        self.flushed_at = time.monotonic()
        return [dict(item) for item in self.drafts.values()]

    def _write(self, snapshot):
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
