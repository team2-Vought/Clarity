"""Автентифікація за ключем пристрою (accounts.tokens).

Браузер надсилає ключ у httpOnly-cookie. Cookie браузер додає й до запитів,
які ініціює чужий сайт, тож змінювальні запити з cookie мають нести заголовок
`X-Requested-With`: чужий сайт не може його поставити без дозволу CORS. Разом
із SameSite=Lax це захист від CSRF. Інші клієнти можуть передати той самий
ключ заголовком `Authorization: Token <ключ>`.
"""

from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.permissions import SAFE_METHODS

from backend.i18n import L

from . import tokens

CSRF_HEADER = 'HTTP_X_REQUESTED_WITH'
# last_used_at оновлюємо не частіше: чат опитує сервер кожні кілька секунд
TOUCH_EVERY = timedelta(minutes=5)


class DeviceTokenAuthentication(BaseAuthentication):
    keyword = 'Token'

    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if header and header[0].lower() == self.keyword.lower().encode():
            if len(header) != 2:
                raise AuthenticationFailed(L('Недійсний токен.', 'Invalid token.'))
            token = tokens.find(header[1].decode(errors='ignore'))
            if token is None or not token.user.is_active:
                raise AuthenticationFailed(L('Недійсний токен.', 'Invalid token.'))
        else:
            token = tokens.find(request.COOKIES.get(settings.AUTH_COOKIE_NAME))
            # застарілий cookie — просто гість: публічні сторінки працюють,
            # а закриті відповідатимуть 401, і інтерфейс попросить увійти знову
            if token is None or not token.user.is_active:
                return None
            if request.method not in SAFE_METHODS and not request.META.get(CSRF_HEADER):
                raise PermissionDenied(L('Запит відхилено (CSRF).', 'Request rejected (CSRF).'))
        now = timezone.now()
        if token.last_used_at is None or now - token.last_used_at > TOUCH_EVERY:
            type(token).objects.filter(pk=token.pk).update(last_used_at=now)
        return token.user, token

    def authenticate_header(self, request):
        return self.keyword
