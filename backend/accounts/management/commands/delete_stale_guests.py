from django.core.management.base import BaseCommand

from accounts.guest import delete_stale


class Command(BaseCommand):
    help = 'Видаляє гостей без реєстрації, старших за GUEST_TTL_DAYS днів, разом з їхніми дискусіями.'

    def handle(self, *args, **options):
        count = delete_stale()
        self.stdout.write(f'Deleted stale guests: {count}')
