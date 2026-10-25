"""Шифрування API-ключів користувачів.

Ключі зберігаються в базі зашифрованими (Fernet). Секрет шифрування —
API_KEYS_SECRET з .env, інакше похідний від DJANGO_SECRET_KEY: після його
зміни збережені ключі стають нечитабельними й вважаються відсутніми.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def _fernet():
    secret = getattr(settings, 'API_KEYS_SECRET', '') or settings.SECRET_KEY
    digest = hashlib.sha256(f'clarity-api-keys:{secret}'.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value):
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token):
    """Розшифрований ключ або '' — якщо секрет змінився чи дані пошкоджені."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return ''


def mask(value):
    """«sk-…a1b2»: досить, щоб упізнати ключ, і нічого, щоб ним скористатися."""
    value = value.strip()
    if len(value) < 12:
        return '…' + value[-2:]
    return f'{value[:3]}…{value[-4:]}'
