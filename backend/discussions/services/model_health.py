"""Пам'ять про збої моделей: квота чи ключ не оживають за хвилину.

Модель, що відповіла помилкою квоти або ключа, на `LLM_COOLDOWN_SECONDS`
(типово 20 хвилин) іде «на відпочинок»: судді й запасні моделі її оминають,
учасник із такою моделлю спершу пробує запасні, а в списку моделей вона
позначена як тимчасово недоступна. Так кожен крок не витрачає час і виклик на
модель, що гарантовано впаде.

Пам'ять окрема для серверного ключа й для кожного власного ключа людини:
вичерпаний ліміт сервера не ховає модель від того, хто платить сам.
Живе в кеші Django (за замовчуванням — у пам'яті процесу).
"""

import hashlib

from django.conf import settings
from django.core.cache import cache

QUOTA = 'quota'
KEY = 'key'
DEFAULT_COOLDOWN = 20 * 60


def _cooldown():
    return int(getattr(settings, 'LLM_COOLDOWN_SECONDS', DEFAULT_COOLDOWN))


def _cache_key(model_id):
    # імпорт тут: catalog імпортує цей модуль
    from .catalog import _provider_key, paid_by_user

    provider_id = str(model_id or '').split(':', 1)[0]
    if paid_by_user(model_id):
        secret = _provider_key(provider_id) or ''
        scope = 'own-' + hashlib.sha256(secret.encode()).hexdigest()[:16]
    else:
        scope = 'server'
    return f'clarity:model-down:{scope}:{model_id}'


def mark_down(model_id, reason):
    """Модель відповіла помилкою квоти (QUOTA) чи ключа (KEY) — оминаємо її якийсь час."""
    seconds = _cooldown()
    if model_id and reason in (QUOTA, KEY) and seconds > 0:
        cache.set(_cache_key(model_id), reason, seconds)


def down_reason(model_id):
    """QUOTA / KEY, якщо модель зараз «відпочиває»; інакше ''."""
    if not model_id:
        return ''
    return cache.get(_cache_key(model_id)) or ''


def clear(model_id):
    if model_id:
        cache.delete(_cache_key(model_id))
