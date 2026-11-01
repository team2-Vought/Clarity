"""Зміна пошти з підтвердженням: нова адреса діє, лише коли власник відкрив лист.

Без підтвердження можна було вписати чужу адресу, а потім її власник,
увійшовши через Google, потрапив би в чужий акаунт. Посилання підписане
SECRET_KEY, діє EMAIL_CHANGE_TIMEOUT і перестає діяти, щойно пошта змінилася
або змінився пароль.

Стара адреса дізнається про зміну двічі: одразу після запиту (якщо це не
власниця — новий пароль скасує зміну) і коли нова пошта набула чинності.
"""

import hashlib
import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.mail import send_mail

from backend.i18n import L

logger = logging.getLogger(__name__)

SALT = 'accounts.email-change'


def _password_mark(user):
    """Відбиток хешу пароля: новий пароль (зокрема через «Забули пароль?»)
    робить недійсним посилання, яке встиг запросити хтось інший."""
    return hashlib.sha256(f'{SALT}:{user.password}'.encode()).hexdigest()[:16]


def make_token(user, new_email):
    return signing.dumps(
        {'u': str(user.pk), 'from': user.email, 'to': new_email, 'p': _password_mark(user)},
        salt=SALT,
    )


def _send(subject, body, address):
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [address])
    except Exception:
        logger.exception('Email change letter failed')
        return False
    return True


def notify_old_address(user, new_email):
    """Попередження на поточну пошту: хтось просить перенести акаунт на іншу адресу."""
    reset = f'{settings.FRONTEND_URL.rstrip("/")}/forgot-password'
    subject = L('Запит на зміну пошти в Clarity', 'Request to change your Clarity email')
    body = L(
        f'Вітаємо, {user.name}!\n\n'
        f'У Clarity попросили змінити пошту вашого акаунта на {new_email}. '
        'Зміна набуде чинності, лише коли власник нової адреси підтвердить її з листа.\n\n'
        'Якщо це були не ви, задайте новий пароль — це скасує зміну пошти й '
        f'виведе з акаунта всі пристрої:\n\n{reset}\n',
        f'Hi {user.name},\n\n'
        f'Someone asked to change the email of your Clarity account to {new_email}. '
        'The change takes effect only after the owner of the new address confirms it.\n\n'
        'If this was not you, set a new password — that cancels the email change '
        f'and signs out every device:\n\n{reset}\n',
    )
    return _send(subject, body, user.email)


def notify_changed(user, old_email):
    """Підтвердження на стару пошту: акаунт тепер на новій адресі."""
    support = getattr(settings, 'SUPPORT_EMAIL', '')
    help_uk = (
        f'Якщо це були не ви, негайно напишіть на {support} — ми допоможемо повернути акаунт.\n'
        if support else 'Якщо це були не ви, зверніться до адміністратора Clarity.\n'
    )
    help_en = (
        f'If this was not you, write to {support} right away — we will help you recover the account.\n'
        if support else 'If this was not you, contact the Clarity administrator.\n'
    )
    subject = L('Пошту акаунта Clarity змінено', 'Your Clarity email has been changed')
    body = L(
        f'Вітаємо, {user.name}!\n\n'
        f'Пошту вашого акаунта Clarity змінено на {user.email}. Листи тепер '
        'приходитимуть туди, а всі інші пристрої вийшли з акаунта.\n\n' + help_uk,
        f'Hi {user.name},\n\n'
        f'The email of your Clarity account has been changed to {user.email}. Emails '
        'will go there now, and all other devices have been signed out.\n\n' + help_en,
    )
    return _send(subject, body, old_email)


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
    return _send(subject, body, new_email)


def read_token(token):
    """(user, new_email) за посиланням або (None, ''), якщо воно недійсне чи застаріле."""
    try:
        data = signing.loads(str(token), salt=SALT, max_age=settings.EMAIL_CHANGE_TIMEOUT)
    except signing.BadSignature:
        return None, ''
    user = get_user_model().objects.filter(pk=data.get('u'), is_active=True).first()
    # пошту вже змінили (цим самим листом чи іншим) — старе посилання не діє
    if user is None or user.email != data.get('from') or data.get('p') != _password_mark(user):
        return None, ''
    return user, str(data.get('to') or '')
