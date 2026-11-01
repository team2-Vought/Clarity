"""Входи на пристроях: окремий ключ на кожен вхід, з терміном дії, у httpOnly-cookie.

Раніше був один спільний DRF-токен без терміну дії в localStorage: його
забирала будь-яка XSS, а «Вийти» виходило на всіх пристроях. Тепер JavaScript
ключа не бачить, у базі лежить лише його хеш, а вихід видаляє один запис.
"""

import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.utils import timezone
from rest_framework.throttling import BaseThrottle

from .models import AuthToken

COOKIE_PATH = '/api/'
LABEL_MAX = 200


def _hash(key):
    return hashlib.sha256(key.encode()).hexdigest()


def client_ip(request):
    """IP клієнта з урахуванням NUM_PROXIES — так само, як рахують ліміти DRF:
    без проксі заголовку X-Forwarded-For не віримо, бо його підробляє будь-хто."""
    return BaseThrottle().get_ident(request) or ''


def find(key):
    """Чинний вхід за ключем або None."""
    if not key:
        return None
    return (
        AuthToken.objects.select_related('user')
        .filter(key_hash=_hash(key), expires_at__gt=timezone.now())
        .first()
    )


def issue(user, request):
    """Новий вхід для пристрою, з якого прийшов запит. Повертає сам ключ."""
    now = timezone.now()
    AuthToken.objects.filter(user=user, expires_at__lte=now).delete()
    key = secrets.token_urlsafe(32)
    AuthToken.objects.create(
        user=user,
        key_hash=_hash(key),
        label=request.META.get('HTTP_USER_AGENT', '')[:LABEL_MAX],
        expires_at=now + timedelta(days=settings.AUTH_TOKEN_DAYS),
    )
    update_last_login(None, user)
    return key


def revoke_all(user, keep=None):
    """Виходить на всіх пристроях, окрім `keep` (поточного входу)."""
    tokens = AuthToken.objects.filter(user=user)
    if keep is not None:
        tokens = tokens.exclude(pk=keep.pk)
    tokens.delete()


def set_cookie(response, key):
    response.set_cookie(
        settings.AUTH_COOKIE_NAME,
        key,
        max_age=settings.AUTH_TOKEN_DAYS * 24 * 3600,
        path=COOKIE_PATH,
        secure=settings.AUTH_COOKIE_SECURE,
        httponly=True,
        samesite='Lax',
    )
    return response


def clear_cookie(response):
    response.delete_cookie(settings.AUTH_COOKIE_NAME, path=COOKIE_PATH, samesite='Lax')
    return response


def sign_in(response, user, request):
    """Вхід: новий ключ пристрою в cookie відповіді."""
    return set_cookie(response, issue(user, request))
