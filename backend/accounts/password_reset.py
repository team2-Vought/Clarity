"""Відновлення пароля листом.

Посилання веде на фронтенд (`FRONTEND_URL/reset-password/<uid>/<token>`);
токен — стандартний Django: він діє PASSWORD_RESET_TIMEOUT і перестає діяти,
щойно пароль змінено, тож одним листом можна скористатися лише раз.
"""

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from backend.i18n import L

logger = logging.getLogger(__name__)


def reset_link(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f'{settings.FRONTEND_URL.rstrip("/")}/reset-password/{uid}/{token}'


def send_reset_email(email):
    """Надсилає лист, якщо акаунт є й активний. Відповідь API від цього не
    залежить: інакше за нею можна було б перевіряти, чи зареєстрована пошта."""
    user = get_user_model().objects.filter(email__iexact=email, is_active=True).first()
    if user is None:
        return
    hours = max(1, round(settings.PASSWORD_RESET_TIMEOUT / 3600))
    subject = L('Відновлення пароля Clarity', 'Reset your Clarity password')
    body = L(
        f'Вітаємо, {user.name}!\n\n'
        'Хтось (сподіваємось, ви) попросив відновити пароль до Clarity. '
        'Щоб задати новий пароль, відкрийте посилання:\n\n'
        f'{reset_link(user)}\n\n'
        f'Посилання діє {hours} год і спрацює лише один раз. '
        'Якщо ви не просили відновлення, просто проігноруйте цей лист — '
        'пароль лишиться тим самим.\n',
        f'Hi {user.name},\n\n'
        'Someone (hopefully you) asked to reset the password for Clarity. '
        'To set a new password, open this link:\n\n'
        f'{reset_link(user)}\n\n'
        f'The link is valid for {hours} h and works only once. '
        'If you did not ask for a reset, just ignore this email — '
        'your password stays the same.\n',
    )
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [user.email])
    except Exception:
        # збій пошти не має розкривати, чи існує акаунт; лишаємо слід для адміна
        logger.exception('Password reset email failed', extra={'user': str(user.pk)})


def user_from_link(uid, token):
    """Користувач за посиланням із листа або None, якщо воно недійсне чи застаріле."""
    try:
        pk = force_str(urlsafe_base64_decode(uid))
        user = get_user_model().objects.filter(pk=pk, is_active=True).first()
    except (TypeError, ValueError, OverflowError):
        return None
    if user is None or not default_token_generator.check_token(user, token):
        return None
    return user
