"""Ліміт спроб входу: окремий лічильник для пари «IP + пошта».

Раніше лічильник був на саму пошту: п'ять неправильних паролів від будь-кого
блокували вхід власникові акаунта. Тепер блокується лише та адреса, з якої
помилялися; перебір з однієї адреси по багатьох акаунтах стримують ліміти
запитів (DEFAULT_THROTTLE_RATES).
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.exceptions import Throttled

from backend.i18n import L

from .models import LoginAttempt

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 10


def check_login_allowed(ip, email):
    """Кидає Throttled (429), якщо з цієї адреси вхід у цей акаунт тимчасово заблоковано."""
    attempt = LoginAttempt.objects.filter(ip=ip, email=email).first()
    if attempt is None:
        return

    now = timezone.now()
    if attempt.locked_until:
        if attempt.locked_until > now:
            seconds = int((attempt.locked_until - now).total_seconds())
            minutes = max(1, (seconds + 59) // 60)
            raise Throttled(
                detail=L(
                    f'Забагато невдалих спроб. Спробуйте через {minutes} хв.',
                    f'Too many failed attempts. Try again in {minutes} min.',
                )
            )
        # блокування минуло — знімаємо лічильник
        attempt.failed_count = 0
        attempt.locked_until = None
        attempt.save(update_fields=['failed_count', 'locked_until', 'updated_at'])
    elif now - attempt.updated_at > timedelta(minutes=LOCKOUT_MINUTES):
        # застарілі невдачі поза вікном — починаємо з нуля
        attempt.failed_count = 0
        attempt.save(update_fields=['failed_count', 'updated_at'])


def register_failed_login(ip, email):
    attempt, _ = LoginAttempt.objects.get_or_create(ip=ip, email=email)
    now = timezone.now()
    if attempt.locked_until and attempt.locked_until <= now:
        attempt.failed_count = 0
        attempt.locked_until = None
    attempt.failed_count += 1
    if attempt.failed_count >= MAX_FAILED_ATTEMPTS:
        attempt.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
    attempt.save()
    return attempt


def reset_login_attempts(email, ip=None):
    """Успішний вхід знімає лічильник цієї адреси; новий пароль — усі лічильники пошти."""
    attempts = LoginAttempt.objects.filter(email=email)
    if ip is not None:
        attempts = attempts.filter(ip=ip)
    attempts.delete()
