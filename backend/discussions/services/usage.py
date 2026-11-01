"""Облік денних лімітів на користувача.

Раніше ліміти рахувалися за наявними дискусіями й повідомленнями, тож
видалення дискусії «повертало» витрачене. Тепер лічильники зберігаються в
DailyUsage і збільшуються в момент створення дискусії чи AI-відповідей.
"""

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from backend.i18n import L

from ..models import DailyUsage


def _limit(name):
    return int(getattr(settings, name, 0) or 0)


def record(user_id, *, discussions=0, replies=0):
    """Атомарно додає використання до сьогоднішнього рядка користувача."""
    if not (discussions or replies):
        return
    today = timezone.localdate()
    changes = {
        'discussions': F('discussions') + discussions,
        'replies': F('replies') + replies,
    }
    if DailyUsage.objects.filter(user_id=user_id, date=today).update(**changes):
        return
    try:
        with transaction.atomic():
            DailyUsage.objects.create(
                user_id=user_id, date=today, discussions=discussions, replies=replies
            )
    except IntegrityError:
        # рядок за сьогодні щойно створив паралельний запит
        DailyUsage.objects.filter(user_id=user_id, date=today).update(**changes)


def today(user):
    """Сьогоднішнє використання (незбережений нульовий рядок, якщо ще нічого)."""
    date = timezone.localdate()
    return DailyUsage.objects.filter(user=user, date=date).first() or DailyUsage(
        user=user, date=date
    )


def over_discussion_limit(user):
    limit = _limit('DISCUSSION_DAILY_LIMIT')
    return bool(limit) and today(user).discussions >= limit


def over_reply_limit(user):
    limit = _limit('DISCUSSION_DAILY_ADVANCE_LIMIT')
    return bool(limit) and today(user).replies >= limit


def reserve_replies(user_id, count):
    """Резервує `count` AI-відповідей до виклику моделей. False — не вміщується в ліміт.

    Перевірка й облік — одним умовним UPDATE: паралельні кроки й виклики не
    проскочать понад ліміт, як було, коли ліміт перевіряли перед кроком, а
    рахували після нього."""
    if count <= 0:
        return True
    limit = _limit('DISCUSSION_DAILY_ADVANCE_LIMIT')
    if not limit:
        record(user_id, replies=count)
        return True
    if count > limit:
        return False
    today = timezone.localdate()
    rows = DailyUsage.objects.filter(user_id=user_id, date=today)
    if rows.filter(replies__lte=limit - count).update(replies=F('replies') + count):
        return True
    if rows.exists():
        return False
    try:
        with transaction.atomic():
            DailyUsage.objects.create(user_id=user_id, date=today, replies=count)
        return True
    except IntegrityError:
        return bool(rows.filter(replies__lte=limit - count).update(replies=F('replies') + count))


def release_replies(user_id, count):
    """Повертає резерв викликів, які не відбулися чи впали без відповіді."""
    if count > 0:
        DailyUsage.objects.filter(user_id=user_id, date=timezone.localdate()).update(
            replies=F('replies') - count
        )


def reply_limit_message():
    limit = _limit('DISCUSSION_DAILY_ADVANCE_LIMIT')
    return L(
        f'Денний ліміт AI-відповідей вичерпано ({limit}). Спробуйте завтра.',
        f'The daily limit of AI replies has been reached ({limit}). Try again tomorrow.',
    )
