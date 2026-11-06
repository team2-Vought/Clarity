"""Мова, якою AI пишуть людині: мова її питання, а не інтерфейсу.

Мова інтерфейсу (`Discussion.language`) задає мову інструкцій для моделей і
службових текстів платформи. Але сперечатися учасники мають тією мовою, якою
людина написала своє питання: англомовне питання в українському інтерфейсі —
англомовна дискусія. Загального «пиши мовою людини» моделям замало — мова
інструкцій переважує, тож мову визначаємо тут і називаємо прямо.

`replying_to(question)` на час кроку дискусії кладе мову в ContextVar, а
`calls._complete` дописує до системного промпту `instruction()`. ContextVar
переходить і в паралельні виклики (їх запускають у копії контексту).
"""

from __future__ import annotations

import re
from contextlib import contextmanager
from contextvars import ContextVar

from backend.i18n import L

_reply = ContextVar('clarity_reply_language', default='')

# назва мови в орудному відмінку («пиши англійською») і англійською
NAMES = {
    'uk': ('українською', 'Ukrainian'),
    'en': ('англійською', 'English'),
    'pl': ('польською', 'Polish'),
    'de': ('німецькою', 'German'),
    'fr': ('французькою', 'French'),
    'es': ('іспанською', 'Spanish'),
    'it': ('італійською', 'Italian'),
    'pt': ('португальською', 'Portuguese'),
    'cs': ('чеською', 'Czech'),
    'nl': ('нідерландською', 'Dutch'),
    'tr': ('турецькою', 'Turkish'),
    'ru': ('російською', 'Russian'),
    'be': ('білоруською', 'Belarusian'),
    'el': ('грецькою', 'Greek'),
    'ar': ('арабською', 'Arabic'),
    'he': ('івритом', 'Hebrew'),
    'ja': ('японською', 'Japanese'),
    'ko': ('корейською', 'Korean'),
    'zh': ('китайською', 'Chinese'),
    'hi': ('гінді', 'Hindi'),
    'ka': ('грузинською', 'Georgian'),
    'hy': ('вірменською', 'Armenian'),
}

# письма, за якими мову видно одразу
_SCRIPTS = [
    ('ja', re.compile(r'[぀-ヿ]')),  # хірагана й катакана — раніше за ієрогліфи
    ('ko', re.compile(r'[가-힯]')),
    ('zh', re.compile(r'[一-鿿]')),
    ('el', re.compile(r'[Ͱ-Ͽ]')),
    ('ar', re.compile(r'[؀-ۿ]')),
    ('he', re.compile(r'[֐-׿]')),
    ('hi', re.compile(r'[ऀ-ॿ]')),
    ('ka', re.compile(r'[Ⴀ-ჿ]')),
    ('hy', re.compile(r'[԰-֏]')),
]

_CYRILLIC = re.compile(r'[Ѐ-ӿ]')
_LATIN = re.compile(r'[a-zà-ɏ]', re.IGNORECASE)
_WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)?", re.UNICODE)

# часті службові слова: за ними латинські мови розрізняються навіть у коротких питаннях
_STOPWORDS = {
    'en': {'the', 'and', 'is', 'are', 'to', 'of', 'in', 'should', 'i', 'my', 'it', 'or', 'what',
           'do', 'for', 'with', 'a', 'have', 'can', 'how', 'be', 'not', 'this', 'that', 'me'},
    'pl': {'czy', 'się', 'nie', 'jest', 'mam', 'na', 'do', 'że', 'jak', 'co', 'mój', 'moja', 'w',
           'z', 'to', 'albo', 'lub', 'warto', 'powinienem', 'powinnam', 'jestem', 'ale'},
    'de': {'ich', 'und', 'der', 'die', 'das', 'ist', 'nicht', 'soll', 'sollte', 'mein', 'meine',
           'oder', 'mit', 'für', 'ein', 'eine', 'zu', 'auf', 'es', 'habe', 'wie', 'was'},
    'fr': {'je', 'le', 'la', 'les', 'et', 'est', 'de', 'des', 'un', 'une', 'dois', 'mon', 'ma',
           'ou', 'pour', 'avec', 'que', 'pas', 'ne', 'il', 'mes', 'faut'},
    'es': {'el', 'la', 'los', 'las', 'y', 'es', 'de', 'que', 'debo', 'mi', 'o', 'para', 'con',
           'un', 'una', 'no', 'por', 'qué', 'cómo', 'tengo', 'mis', 'me'},
    'it': {'il', 'lo', 'la', 'gli', 'e', 'è', 'di', 'che', 'devo', 'mio', 'mia', 'o', 'per',
           'con', 'un', 'una', 'non', 'ho', 'come', 'cosa', 'mi'},
    'pt': {'o', 'a', 'os', 'as', 'e', 'é', 'de', 'que', 'devo', 'meu', 'minha', 'ou', 'para',
           'com', 'um', 'uma', 'não', 'tenho', 'como', 'em', 'eu'},
    'cs': {'je', 'se', 'na', 'že', 'mám', 'bych', 'nebo', 'jak', 'co', 'můj', 'moje', 'to', 'v',
           'z', 'ale', 'jsem', 'mít', 'měl', 'měla'},
    'nl': {'ik', 'de', 'het', 'een', 'en', 'is', 'van', 'moet', 'mijn', 'of', 'voor', 'met',
           'niet', 'dat', 'op', 'te', 'heb', 'wat', 'hoe'},
    'tr': {'ve', 'bir', 'bu', 'mi', 'mı', 'mu', 'mü', 'için', 'ile', 'ben', 'benim', 'ne',
           'nasıl', 'değil', 'var', 'yok', 'ama', 'veya'},
}

# літери, які в латиниці майже однозначно вказують на мову
_LETTERS = {
    # без IGNORECASE: інакше турецька «ı» збігається з англійською «I»
    'pl': re.compile(r'[ąęłśżźćńĄĘŁŚŻŹĆŃ]'),
    'de': re.compile(r'[äöüßÄÖÜ]'),
    'es': re.compile(r'[ñ¿¡Ñ]'),
    'pt': re.compile(r'[ãõÃÕ]'),
    'cs': re.compile(r'[řůěšŘŮĚŠ]'),
    'tr': re.compile(r'[ğışĞŞİ]'),
}

_UK_WORDS = {'що', 'чи', 'як', 'це', 'мені', 'варто', 'й', 'та', 'або', 'але', 'я', 'мій', 'моя'}
_RU_WORDS = {'что', 'как', 'это', 'мне', 'стоит', 'или', 'но', 'я', 'мой', 'моя', 'ли', 'и'}

# уточнення до питання дописуються з підписом мовою інтерфейсу — його не рахуємо
_CLARIFY_HEADINGS = ('Уточнення від користувача:', 'Clarifications from the user:')


def _own_text(question):
    text = str(question or '')
    for heading in _CLARIFY_HEADINGS:
        text = text.split(heading, 1)[0]
    return text


def detect(question):
    """Код мови питання людини ('en', 'uk', 'pl'…) або '' — якщо не впевнені."""
    text = _own_text(question)
    for code, script in _SCRIPTS:
        if script.search(text):
            return code
    cyrillic = len(_CYRILLIC.findall(text))
    latin = len(_LATIN.findall(text))
    if not cyrillic and not latin:
        return ''
    words = [word.casefold() for word in _WORD.findall(text)]
    if cyrillic >= latin:
        # «ў» — лише білоруська; «ї», «є», «ґ» — лише українська; «і» є в обох,
        # а «ы», «э», «ъ», «ё» — у російській (і білоруській, яку вже відсіяли)
        if re.search(r'ў', text, re.IGNORECASE):
            return 'be'
        if re.search(r'[їєґ]', text, re.IGNORECASE):
            return 'uk'
        if re.search(r'[ыэъё]', text, re.IGNORECASE):
            return 'ru'
        if re.search(r'і', text, re.IGNORECASE):
            return 'uk'
        uk = sum(word in _UK_WORDS for word in words)
        ru = sum(word in _RU_WORDS for word in words)
        if uk > ru:
            return 'uk'
        if ru > uk:
            return 'ru'
        return ''
    scores = {code: sum(word in stop for word in words) for code, stop in _STOPWORDS.items()}
    for code, letters in _LETTERS.items():
        if letters.search(text):
            scores[code] += 3
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return ''
    # нічия між мовами — не вгадуємо
    if sorted(scores.values())[-2] == scores[best]:
        return ''
    return best


def current():
    return _reply.get()


@contextmanager
def replying_to(question):
    """На час кроку: AI пишуть мовою цього питання."""
    token = _reply.set(detect(question))
    try:
        yield
    finally:
        _reply.reset(token)


def instruction():
    """Рядок для кінця системного промпту: якою мовою писати. '' — мову не визначено."""
    code = _reply.get()
    if code not in NAMES:
        return ''
    instrumental, name = NAMES[code]
    return L(
        f'Мова відповіді — {instrumental}. Людина пише {instrumental}, тож усе, що ти '
        f'пишеш для неї (репліки, тези, рішення, текстові поля JSON), пиши {instrumental}, '
        'навіть якщо ці інструкції та інші учасники — іншою мовою. Службові слова формату '
        '(ТЕЗА, ПОЗИЦІЯ, ПОШУК, ключі JSON і значення на кшталт «так» / «ні») лишай як є.',
        f'Reply language — {name}. The person writes in {name}, so everything you '
        f'write for them (replies, theses, decisions, text fields in JSON) must be in {name}, '
        'even if these instructions and other participants use another language. Keep the '
        'format keywords (THESIS, STANCE, SEARCH, JSON keys and values such as “yes” / “no”) as they are.',
    )
