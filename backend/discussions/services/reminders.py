"""Листи «Як ваше рішення?»: коли настав час підбити підсумок запису журналу.

Надсилає воркер дискусій (раз на DISCUSSION_REMINDER_INTERVAL секунд) або
команда `manage.py send_decision_reminders` — напр. з cron. Кожен запис
отримує лише один лист; у застосунку нагадування видно й без листа.
"""

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.mail import EmailMessage
from django.utils import formats, timezone

from backend.i18n import L, using

from ..account_settings import preferences_of
from ..models import Decision

logger = logging.getLogger(__name__)

UNSUBSCRIBE_SALT = 'discussions.journal-unsubscribe'


def unsubscribe_token(user):
    """Підписаний id людини: посилання відписки працює без входу й не застаріває."""
    return signing.dumps({'u': str(user.pk)}, salt=UNSUBSCRIBE_SALT)


def user_from_unsubscribe(token):
    try:
        data = signing.loads(str(token), salt=UNSUBSCRIBE_SALT)
    except signing.BadSignature:
        return None
    return get_user_model().objects.filter(pk=data.get('u')).first()


def unsubscribe(user):
    """Вимикає листи журналу; решта налаштувань лишається."""
    preferences = dict(user.preferences) if isinstance(user.preferences, dict) else {}
    preferences['journal_emails'] = False
    user.preferences = preferences
    user.save(update_fields=['preferences'])


def unsubscribe_links(user):
    """(сторінка для людини, адреса для поштового клієнта — RFC 8058)."""
    base = settings.FRONTEND_URL.rstrip('/')
    token = unsubscribe_token(user)
    return f'{base}/unsubscribe/{token}', f'{base}/api/journal/unsubscribe/{token}/'


def _letter(entry):
    link = f'{settings.FRONTEND_URL.rstrip("/")}/journal?review={entry.id}'
    when = formats.date_format(timezone.localtime(entry.created_at), 'j E Y')
    subject = L('Як ваше рішення? — Clarity', 'How is your decision going? — Clarity')
    body = L(
        f'Вітаємо, {entry.user.name}!\n\n'
        f'{when} ви вирішили:\n«{entry.decision}»\n\n'
        'Як воно? Розкажіть одним кліком — так у журналі складається історія '
        'ваших рішень і того, як вони спрацювали:\n\n'
        f'{link}\n\n'
        'Не хочете таких листів — відпишіться одним кліком:\n'
        f'{unsubscribe_links(entry.user)[0]}\n',
        f'Hi {entry.user.name},\n\n'
        f'On {when} you decided:\n“{entry.decision}”\n\n'
        'How is it going? Tell us in one click — this is how your journal builds '
        'a history of your decisions and how they worked out:\n\n'
        f'{link}\n\n'
        'Don’t want these emails? Unsubscribe in one click:\n'
        f'{unsubscribe_links(entry.user)[0]}\n',
    )
    return subject, body


def send_due_reminders(now=None):
    """Надсилає листи для записів, яким настав час; повертає, скільки надіслано."""
    now = now or timezone.now()
    entries = Decision.objects.filter(
        reviewed_at__isnull=True, reminded_at__isnull=True, check_at__lte=now, user__is_active=True
    ).select_related('user')
    sent = 0
    for entry in entries:
        # спершу захоплюємо запис умовним UPDATE: з кількох воркерів лист надішле
        # лише той, чий UPDATE змінив рядок. Позначка ставиться й без листа:
        # людина, що вимкнула листи, не отримає їх пачкою, якщо потім увімкне
        if not Decision.objects.filter(pk=entry.pk, reminded_at__isnull=True).update(reminded_at=now):
            continue
        if not preferences_of(entry.user).get('journal_emails', True):
            continue
        with using(entry.language):
            subject, body = _letter(entry)
        _, one_click = unsubscribe_links(entry.user)
        letter = EmailMessage(
            subject,
            body,
            settings.DEFAULT_FROM_EMAIL,
            [entry.user.email],
            # відписка просто з поштового клієнта (Gmail, Outlook) — так листи рідше йдуть у спам
            headers={
                'List-Unsubscribe': f'<{one_click}>',
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
        )
        try:
            letter.send()
            sent += 1
        except Exception:
            logger.exception('Decision reminder failed', extra={'decision': str(entry.pk)})
            # лист не пішов — знімаємо позначку, наступний прохід спробує знову
            Decision.objects.filter(pk=entry.pk, reminded_at=now).update(reminded_at=None)
    return sent
