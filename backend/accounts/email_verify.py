"""Підтвердження пошти після реєстрації.

Новий акаунт одразу може ввійти й роздивитися застосунок, але дискусії
(а з ними й платні виклики моделей) стартують лише з підтвердженою поштою —
інакше акаунти на вигадані адреси стали б безкоштовним доступом до моделей.
Вимогу вмикає REQUIRE_EMAIL_VERIFICATION (типово — у продакшні).

Посилання підписане SECRET_KEY, діє EMAIL_VERIFY_TIMEOUT і перестає діяти,
щойно змінилась пошта акаунта.
"""

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.mail import send_mail

from backend.i18n import L

logger = logging.getLogger(__name__)

SALT = 'accounts.email-verify'


def required():
    return bool(getattr(settings, 'REQUIRE_EMAIL_VERIFICATION', False))


def blocked(user):
    """Чи заборонено цій людині запускати дискусії, доки пошту не підтверджено."""
    return required() and not getattr(user, 'email_verified', True)


def make_token(user):
    return signing.dumps({'u': str(user.pk), 'e': user.email}, salt=SALT)


def link(user):
    return f'{settings.FRONTEND_URL.rstrip("/")}/verify-email/{make_token(user)}'


def send_verification(user):
    """Лист із посиланням. False — лист не пішов."""
    hours = max(1, round(settings.EMAIL_VERIFY_TIMEOUT / 3600))
    url = link(user)
    subject = L('Підтвердіть пошту для Clarity', 'Confirm your email for Clarity')
    body = L(
        f'Вітаємо, {user.name}!\n\n'
        'Дякуємо за реєстрацію в Clarity. Щоб запускати дискусії, підтвердьте пошту:\n\n'
        f'{url}\n\n'
        f'Посилання діє {hours} год. Якщо ви не реєструвались, просто проігноруйте цей лист.\n',
        f'Hi {user.name},\n\n'
        'Thanks for signing up for Clarity. To start discussions, confirm your email:\n\n'
        f'{url}\n\n'
        f'The link is valid for {hours} h. If you did not sign up, just ignore this email.\n',
    )
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [user.email])
    except Exception:
        logger.exception('Verification email failed')
        return False
    return True


def read_token(token):
    """Користувач за посиланням або None, якщо воно недійсне, застаріле чи пошта вже інша."""
    try:
        data = signing.loads(str(token), salt=SALT, max_age=settings.EMAIL_VERIFY_TIMEOUT)
    except signing.BadSignature:
        return None
    user = get_user_model().objects.filter(pk=data.get('u'), is_active=True).first()
    if user is None or user.email != data.get('e'):
        return None
    return user
