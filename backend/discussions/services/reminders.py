"""Листи «Як ваше рішення?»: коли настав час підбити підсумок запису журналу.

Надсилає воркер дискусій (раз на DISCUSSION_REMINDER_INTERVAL секунд) або
команда `manage.py send_decision_reminders` — напр. з cron. Кожен запис
отримує лише один лист; у застосунку нагадування видно й без листа.
"""

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.utils import formats, timezone

from backend.i18n import L, using

from ..account_settings import preferences_of
from ..models import Decision

logger = logging.getLogger(__name__)


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
        'Не хочете таких листів — вимкніть їх у журналі рішень.\n',
        f'Hi {entry.user.name},\n\n'
        f'On {when} you decided:\n“{entry.decision}”\n\n'
        'How is it going? Tell us in one click — this is how your journal builds '
        'a history of your decisions and how they worked out:\n\n'
        f'{link}\n\n'
        'Don’t want these emails? Turn them off in the decision journal.\n',
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
        # позначка ставиться навіть без листа: людина, що вимкнула листи, не отримає
        # їх пачкою, якщо потім увімкне
        if preferences_of(entry.user).get('journal_emails', True):
            with using(entry.language):
                subject, body = _letter(entry)
            try:
                send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [entry.user.email])
                sent += 1
            except Exception:
                logger.exception('Decision reminder failed', extra={'decision': str(entry.pk)})
                continue
        Decision.objects.filter(pk=entry.pk).update(reminded_at=now)
    return sent
