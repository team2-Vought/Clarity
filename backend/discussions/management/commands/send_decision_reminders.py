from django.core.management.base import BaseCommand

from discussions.services.reminders import send_due_reminders


class Command(BaseCommand):
    help = 'Надсилає листи «Як ваше рішення?» для записів журналу, яким настав час.'

    def handle(self, *args, **options):
        sent = send_due_reminders()
        self.stdout.write(f'Reminders sent: {sent}')
