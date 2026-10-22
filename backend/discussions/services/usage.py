"""Облік денних лімітів на користувача.

Раніше ліміти рахувалися за наявними дискусіями й повідомленнями, тож
видалення дискусії «повертало» витрачене. Тепер лічильники зберігаються в
DailyUsage і збільшуються в момент створення дискусії чи AI-відповідей.
"""

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

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
