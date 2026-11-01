"""Зміна пошти з підтвердженням: нова адреса діє, лише коли власник відкрив лист.

Без підтвердження можна було вписати чужу адресу, а потім її власник,
увійшовши через Google, потрапив би в чужий акаунт. Посилання підписане
SECRET_KEY, діє EMAIL_CHANGE_TIMEOUT і перестає діяти, щойно пошта змінилася.
"""

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.mail import send_mail

from backend.i18n import L

logger = logging.getLogger(__name__)

SALT = 'accounts.email-change'


def make_token(user, new_email):
    return signing.dumps({'u': str(user.pk), 'from': user.email, 'to': new_email}, salt=SALT)


def confirm_link(user, new_email):
    return f'{settings.FRONTEND_URL.rstrip("/")}/confirm-email/{make_token(user, new_email)}'


def send_confirmation(user, new_email):
    """Лист на нову адресу. False — лист не пішов."""
    hours = max(1, round(settings.EMAIL_CHANGE_TIMEOUT / 3600))
    link = confirm_link(user, new_email)
    subject = L('Підтвердіть нову пошту для Clarity', 'Confirm your new email for Clarity')
    body = L(
        f'Вітаємо, {user.name}!\n\n'
        f'У Clarity попросили змінити пошту акаунта на {new_email}. '
        'Щоб підтвердити, відкрийте посилання:\n\n'
        f'{link}\n\n'
        f'Посилання діє {hours} год. Якщо ви нічого не змінювали, просто '
        'проігноруйте цей лист.\n',
        f'Hi {user.name},\n\n'
        f'Someone asked to change the email of a Clarity account to {new_email}. '
        'To confirm, open this link:\n\n'
        f'{link}\n\n'
        f'The link is valid for {hours} h. If you did not change anything, '
        'just ignore this email.\n',
    )
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [new_email])
    except Exception:
        logger.exception('Email change confirmation failed', extra={'user': str(user.pk)})
        return False
    return True


def read_token(token):
    """(user, new_email) за посиланням або (None, ''), якщо воно недійсне чи застаріле."""
    try:
        data = signing.loads(str(token), salt=SALT, max_age=settings.EMAIL_CHANGE_TIMEOUT)
    except signing.BadSignature:
        return None, ''
    user = get_user_model().objects.filter(pk=data.get('u'), is_active=True).first()
    # пошту вже змінили (цим самим листом чи іншим) — старе посилання не діє
    if user is None or user.email != data.get('from'):
        return None, ''
    return user, str(data.get('to') or '')
