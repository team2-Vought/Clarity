"""
URL configuration for backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path
from django.views.decorators.http import require_GET

from discussions.share_page import shared_page



@require_GET
def health(request):
    """Перевірка для оркестратора (docker compose, балансувальник): процес живий і база відповідає."""
    with connection.cursor() as cursor:
        cursor.execute('SELECT 1')
    return JsonResponse({'ok': True})


urlpatterns = [
    path('api/health/', health, name='health'),
    path('api/auth/', include('accounts.urls')),
    path('api/support/', include('support.urls')),
    path('api/', include('discussions.urls')),
    # прев'ю публічного посилання для месенджерів (nginx віддає /shared/ бекенду)
    path('shared/<uuid:token>', shared_page, name='shared-page'),
]
# адмінка — на адресі з DJANGO_ADMIN_URL (не стандартній), порожньо — вимкнена
if settings.ADMIN_URL:
    urlpatterns.insert(0, path(settings.ADMIN_URL, admin.site.urls))
