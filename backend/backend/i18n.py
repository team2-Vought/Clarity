"""Мова інтерфейсу й відповідей AI: українська або англійська.

Мову запиту визначає LocaleMiddleware за заголовком Accept-Language, який
надсилає фронтенд. Дискусія запам'ятовує мову, якою її створили, і кроки
в фоновому потоці виконуються саме нею (`using`).

Тексти задаються парами прямо на місці: `L('Дискусію не знайдено', 'Discussion not found')`.
"""

from contextlib import contextmanager
from contextvars import ContextVar

from django.utils import translation
from django.utils.functional import lazy

LANGUAGES = ('uk', 'en')
DEFAULT_LANGUAGE = 'uk'

# Мова дискусії для `using`. Активна мова Django не переходить у нові потоки
# навіть через contextvars.copy_context(), а рядок статусу й паралельні виклики
# моделей працюють саме в потоках — ContextVar туди копіюється.
_language = ContextVar('clarity_language', default=None)


def normalize(language):
    code = str(language or '').strip().lower()[:2]
    return code if code in LANGUAGES else DEFAULT_LANGUAGE


def current():
    return normalize(_language.get() or translation.get_language())


def is_en():
    return current() == 'en'


def L(uk, en):
    """Текст поточною мовою."""
    return en if is_en() else uk


# Для констант модуля (повідомлення валідації): текст обирається під час показу,
# тобто мовою запиту, а не мовою, активною під час імпорту
lazy_L = lazy(L, str)


@contextmanager
def using(language):
    """Контекст, у якому всі тексти й промпти — мовою `language`,
    зокрема в потоках, запущених через contextvars.copy_context()."""
    language = normalize(language)
    token = _language.set(language)
    try:
        with translation.override(language):
            yield
    finally:
        _language.reset(token)
