"""Ліміт спроб входу: окремий лічильник для кожного акаунта (пошти).

Інші акаунти не залежать від блокування — ліміт застосовується лише
до тієї пошти, з якої помилково вводили пароль.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.exceptions import Throttled

from .models import LoginAttempt

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 10


def check_login_allowed(email):
    """Кидає Throttled (429), якщо акаунт тимчасово заблоковано."""
    attempt = LoginAttempt.objects.filter(email=email).first()
    if attempt is None:
        return

    now = timezone.now()
    if attempt.locked_until:
        if attempt.locked_until > now:
            seconds = int((attempt.locked_until - now).total_seconds())
            minutes = max(1, (seconds + 59) // 60)
            raise Throttled(
                detail=(
                    f'Ліміт спроб вичерпано для цього акаунта. '
                    f'Спробуйте через {minutes} хв.'
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


def register_failed_login(email):
    attempt, _ = LoginAttempt.objects.get_or_create(email=email)
    now = timezone.now()
    if attempt.locked_until and attempt.locked_until <= now:
        attempt.failed_count = 0
        attempt.locked_until = None
    attempt.failed_count += 1
    if attempt.failed_count >= MAX_FAILED_ATTEMPTS:
        attempt.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
    attempt.save()
    return attempt


def reset_login_attempts(email):
    LoginAttempt.objects.filter(email=email).delete()
