"""Дрібниці, спільні для всіх промптів: режим відповіді, дата, теза, підписи позицій."""

import re

from django.utils import timezone

from backend.i18n import L


def mode_block(mode, options):
    if mode == 'yes_no':
        return L(
            'Режим дискусії: «Так або ні».\n'
            'Висновок дискусії має бути однозначним: ТАК або НІ.',
            'Discussion mode: “Yes or no”.\n'
            'The conclusion must be unambiguous: YES or NO.',
        )
    if mode == 'choose_one':
        variants = '; '.join(options or [])
        return L(
            'Режим дискусії: «Один із варіантів».\n'
            f'Варіанти: {variants}\n'
            'Висновок має чітко обрати один із них.',
            'Discussion mode: “One of the options”.\n'
            f'Options: {variants}\n'
            'The conclusion must clearly choose one of them.',
        )
    return L(
        'Режим дискусії: «Вільна відповідь» (генеративний висновок).',
        'Discussion mode: “Open answer” (a generative conclusion).',
    )


def _inline(value, fallback=''):
    text = ' '.join(str(value or '').split())
    return text or fallback


THESIS_LIMIT = 220
_SENTENCE_END_RE = re.compile(r'(?<=[.!?…])\s')
# заголовки й розділювачі прибираємо цілком, у решти рядків — лише розмітку
_MARKDOWN_RE = re.compile(
    r'^\s*(?:#{1,6}\s.*|-{3,}|\*{3,})\s*$|^\s*(?:[-*•]\s+|\d+[.)]\s+|>\s*)|\*\*|__|~~',
    re.MULTILINE,
)


def fallback_thesis(content):
    """Перше речення репліки як стисла теза, якщо модель не дала власну."""
    text = _inline(_MARKDOWN_RE.sub('', str(content or '')))
    if not text:
        return ''
    first = _SENTENCE_END_RE.split(text, maxsplit=1)[0]
    if len(first) > THESIS_LIMIT:
        first = first[: THESIS_LIMIT - 1].rstrip() + '…'
    return first


ROLE_LABELS = {
    'user': 'користувач',
    'ai': 'AI-учасник',
    'moderator': 'модератор',
    'devil': 'AI Devil',
    'research': 'пошук',
}

ROLE_LABELS_EN = {
    'user': 'user',
    'ai': 'AI participant',
    'moderator': 'moderator',
    'devil': 'AI Devil',
    'research': 'search',
}

# Позиції зберігаються українськими токенами; в англійському промпті — їхні відповідники
STANCE_LABELS_EN = {'так': 'yes', 'ні': 'no', 'згода': 'agree', 'суперечка': 'dispute'}


def stance_label(stance):
    return L(stance, STANCE_LABELS_EN.get(stance, stance))


def _today_line():
    # без дати моделі вважають «сьогодні» днем свого навчання й плутають, що вже застаріло
    today = timezone.localdate()
    return L(f'Сьогодні: {today.strftime("%d.%m.%Y")}', f'Today: {today.isoformat()}')
