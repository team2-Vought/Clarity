"""Спільні middleware проєкту."""

from django.conf import settings
from django.http import JsonResponse

from backend.i18n import L


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
