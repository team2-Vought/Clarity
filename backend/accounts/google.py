"""Вхід через Google.

Браузер отримує від Google access-токен (кнопка «Продовжити з Google»),
сервер перевіряє його в самого Google: токен виданий саме нашому клієнту
(`aud` == GOOGLE_CLIENT_ID), пошта підтверджена. Лише тоді входимо в акаунт
із цією поштою або створюємо новий.
"""

import httpx
from django.conf import settings

TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'
USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
TIMEOUT_SECONDS = 10


class GoogleAuthError(Exception):
    """`code`: not_configured | invalid | unverified | unavailable."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def client_id():
    return (getattr(settings, 'GOOGLE_CLIENT_ID', '') or '').strip()


def verify(access_token):
    """{'email', 'name'} власника токена; інакше GoogleAuthError."""
    expected = client_id()
    if not expected:
        raise GoogleAuthError('not_configured')
    if not access_token or not isinstance(access_token, str):
        raise GoogleAuthError('invalid')
    try:
        info = httpx.get(
            TOKENINFO_URL, params={'access_token': access_token}, timeout=TIMEOUT_SECONDS
        )
        if info.status_code != 200:
            raise GoogleAuthError('invalid')
        # токен, виданий іншому сайту, не відкриває акаунт у нас
        if info.json().get('aud') != expected:
            raise GoogleAuthError('invalid')
        profile = httpx.get(
            USERINFO_URL,
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=TIMEOUT_SECONDS,
        )
        if profile.status_code != 200:
            raise GoogleAuthError('invalid')
        data = profile.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GoogleAuthError('unavailable') from exc
    email = str(data.get('email') or '').strip().lower()
    if not email:
        raise GoogleAuthError('invalid')
    if data.get('email_verified') is not True:
        raise GoogleAuthError('unverified')
    return {'email': email, 'name': str(data.get('name') or data.get('given_name') or '')}
