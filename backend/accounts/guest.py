"""Гостьовий режим: одна дискусія з лендингу без реєстрації.

Гість — звичайний користувач з позначкою is_guest, службовою поштою й без
пароля. Він входить тим самим ключем у httpOnly-cookie, тож увесь застосунок
працює для нього без змін; ліміти в нього менші (discussions.services.usage).

Коли гість реєструється чи входить у свій акаунт на тому ж пристрої, його
дискусії, журнал і вкладення переходять у справжній акаунт, а сам гість
зникає (adopt). Гостей, що так і не зареєструвались, прибирає команда
`delete_stale_guests` через GUEST_TTL_DAYS днів.
"""

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from backend.i18n import L

from . import tokens

# .invalid зарезервовано (RFC 2606): на таку адресу лист не піде нікуди
EMAIL_DOMAIN = 'guest.clarity.invalid'


def enabled():
    return int(getattr(settings, 'GUEST_DAILY_LIMIT', 0) or 0) > 0


def is_guest(user):
    return bool(getattr(user, 'is_guest', False))


def over_daily_cap():
    """На весь сайт за добу — не більше GUEST_DAILY_LIMIT гостей."""
    start = timezone.now() - timedelta(days=1)
    created = get_user_model().objects.filter(is_guest=True, date_joined__gte=start).count()
    return created >= int(settings.GUEST_DAILY_LIMIT)


def create():
    user = get_user_model().objects.create_user(
        email=f'guest-{secrets.token_hex(12)}@{EMAIL_DOMAIN}',
        name=L('Гість', 'Guest'),
        password=None,
    )
    user.is_guest = True
    user.save(update_fields=['is_guest'])
    return user


def guest_from_request(request):
    """Гість, що досі увійшов на цьому пристрої (за cookie), або None.

    Вхід і реєстрація не автентифікують запит, тож cookie читаємо самі."""
    token = tokens.find(request.COOKIES.get(settings.AUTH_COOKIE_NAME))
    if token is None or not is_guest(token.user):
        return None
    return token.user


def adopt(request, user):
    """Переносить дані гостя з цього пристрою в акаунт `user` і видаляє гостя.

    Повертає, скільки дискусій перенесено."""
    guest = guest_from_request(request)
    if guest is None or guest.pk == user.pk or is_guest(user):
        return 0
    # моделі discussions імпортуємо тут: accounts не залежить від них під час завантаження
    from discussions.models import Attachment, Decision, Discussion

    with transaction.atomic():
        moved = Discussion.objects.filter(user=guest).update(user=user)
        Decision.objects.filter(user=guest).update(user=user)
        Attachment.objects.filter(user=guest).update(user=user)
        guest.delete()
    return moved


def delete_stale(now=None):
    """Видаляє гостей, старших за GUEST_TTL_DAYS. Повертає, скільки видалено."""
    now = now or timezone.now()
    cutoff = now - timedelta(days=int(settings.GUEST_TTL_DAYS))
    stale = get_user_model().objects.filter(is_guest=True, date_joined__lt=cutoff)
    count = stale.count()
    stale.delete()
    return count
