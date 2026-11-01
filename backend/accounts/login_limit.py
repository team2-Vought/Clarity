"""Ліміт спроб входу: окремий лічильник для пари «IP + пошта».

Раніше лічильник був на саму пошту: п'ять неправильних паролів від будь-кого
блокували вхід власникові акаунта. Тепер блокується лише та адреса, з якої
помилялися; перебір з однієї адреси по багатьох акаунтах стримують ліміти
запитів (DEFAULT_THROTTLE_RATES).

Перебір одного акаунта з багатьох адрес стримує загальна стеля на пошту:
EMAIL_MAX_FAILED невдач за EMAIL_WINDOW_MINUTES з будь-яких адрес блокують вхід
паролем на годину. Її лічильник — рядок з ip=ANY_IP. Власниця тоді входить
через Google або відновлює пароль: новий пароль знімає всі лічильники.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.exceptions import Throttled

from backend.i18n import L

from .models import LoginAttempt

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 10
# загальна стеля на одну пошту з усіх адрес разом
EMAIL_MAX_FAILED = 50
EMAIL_WINDOW_MINUTES = 60
EMAIL_LOCKOUT_MINUTES = 60
# справжній IP таким не буває
ANY_IP = '*'


def _minutes_left(locked_until, now):
    return max(1, (int((locked_until - now).total_seconds()) + 59) // 60)


def _check_email_cap(email, now):
    total = LoginAttempt.objects.filter(ip=ANY_IP, email=email).first()
    if total is not None and total.locked_until and total.locked_until > now:
        minutes = _minutes_left(total.locked_until, now)
        raise Throttled(
            detail=L(
                'Забагато невдалих спроб увійти в цей акаунт. Спробуйте через '
                f'{minutes} хв або відновіть пароль — тоді вхід відкриється одразу.',
                'Too many failed attempts to sign in to this account. Try again in '
                f'{minutes} min or reset your password — that unlocks it at once.',
            )
        )


def _count_email_failure(email, now):
    total, _ = LoginAttempt.objects.get_or_create(ip=ANY_IP, email=email)
    if total.locked_until and total.locked_until <= now:
        total.locked_until = None
        total.failed_count = 0
    elif now - total.updated_at > timedelta(minutes=EMAIL_WINDOW_MINUTES):
        total.failed_count = 0
    # PositiveSmallIntegerField: далі стелі не рахуємо
    total.failed_count = min(total.failed_count + 1, EMAIL_MAX_FAILED)
    if total.failed_count >= EMAIL_MAX_FAILED and not total.locked_until:
        total.locked_until = now + timedelta(minutes=EMAIL_LOCKOUT_MINUTES)
    total.save()


def check_login_allowed(ip, email):
    """Кидає Throttled (429), якщо з цієї адреси вхід у цей акаунт тимчасово заблоковано
    або акаунт перебирають з багатьох адрес."""
    now = timezone.now()
    _check_email_cap(email, now)
    attempt = LoginAttempt.objects.filter(ip=ip, email=email).first()
    if attempt is None:
        return

    if attempt.locked_until:
        if attempt.locked_until > now:
            minutes = _minutes_left(attempt.locked_until, now)
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
    now = timezone.now()
    _count_email_failure(email, now)
    attempt, _ = LoginAttempt.objects.get_or_create(ip=ip, email=email)
    if attempt.locked_until and attempt.locked_until <= now:
        attempt.failed_count = 0
        attempt.locked_until = None
    attempt.failed_count += 1
    if attempt.failed_count >= MAX_FAILED_ATTEMPTS:
        attempt.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
    attempt.save()
    return attempt


def reset_login_attempts(email, ip=None):
    """Успішний вхід знімає лічильник цієї адреси (загальна стеля пошти лишається);
    новий пароль — усі лічильники пошти, зокрема стелю."""
    attempts = LoginAttempt.objects.filter(email=email)
    if ip is not None:
        attempts = attempts.filter(ip=ip)
    attempts.delete()
