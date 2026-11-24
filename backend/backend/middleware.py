"""Спільні middleware проєкту."""

from django.conf import settings
from django.db import connection
from django.http import JsonResponse

from backend.i18n import L


HEALTH_PATH = '/api/health/'


class HealthCheckMiddleware:
    """`GET /api/health/` для оркестратора (docker compose, балансувальник).

    Стоїть першим: healthcheck контейнера ходить на http://127.0.0.1:8000, а далі
    SecurityMiddleware перенаправив би його на https (SECURE_SSL_REDIRECT), а
    перевірка хоста відхилила б 127.0.0.1, якого немає в ALLOWED_HOSTS. Тоді
    бекенд вічно «нездоровий», і воркер дискусій, що чекає на нього, не стартує.
    Відповідь не залежить від хоста й нічого не розкриває: процес живий і база відповідає."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path == HEALTH_PATH and request.method in {'GET', 'HEAD'}:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
            return JsonResponse({'ok': True}, headers={'Cache-Control': 'no-store'})
        return self.get_response(request)


class RequestSizeLimitMiddleware:
    """413 для запиту, більшого за REQUEST_MAX_BYTES, ще до читання тіла.

    DATA_UPLOAD_MAX_MEMORY_SIZE не обмежує файли в multipart, тож без цього
    Django прочитав би на диск запит будь-якого розміру. Перший рубіж — nginx
    (`client_max_body_size`), це — запасний."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            length = int(request.META.get('CONTENT_LENGTH') or 0)
        except ValueError:
            length = 0
        if length > settings.REQUEST_MAX_BYTES:
            return JsonResponse(
                {'detail': L('Запит завеликий.', 'The request is too large.'), 'code': 'too_large'},
                status=413,
            )
        return self.get_response(request)
