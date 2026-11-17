"""Галерея прикладів (frontend/public/examples): проганяє теми справжнім рушієм
і зберігає кожну дискусію JSON-ом у форматі публічного посилання.

Потрібен хоча б один ключ моделі в .env. Дискусії йдуть у базу, з якою запущено
команду, від службового користувача, якого команда створює й наприкінці видаляє;
на безкоштовних ключах одна тема займає кілька хвилин.

    python manage.py generate_examples                   # усі теми, обидві мови
    python manage.py generate_examples relocate --force  # одну тему заново
"""

from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.test import override_settings
from rest_framework.renderers import JSONRenderer
from rest_framework.test import APIClient

from discussions.models import Discussion
from discussions.serializers import SharedDiscussionSerializer

OUT = Path(settings.BASE_DIR).parent / 'frontend' / 'public' / 'examples'
SERVICE_EMAIL = 'examples@clarity.invalid'

EXAMPLES = {
    'relocate': {
        'personas': ['logician', 'emotional', 'skeptic', 'pragmatist'],
        'uk': 'Мені 29, я бекенд-розробник у Львові. Отримав офер у Варшаві: +40% до зарплати, '
              'релокаційний пакет 3000 €, але контракт B2B і випробувальний термін 3 місяці. '
              'У Львові — дівчина (вона може переїхати не раніше ніж за пів року), батьки й друзі, '
              'своя квартира без іпотеки. Поточна робота стабільна, але зростання немає вже два роки. '
              'Переїжджати чи лишатися?',
        'en': 'I am 29, a backend developer in Lisbon. I got an offer in Berlin: +40% salary and a '
              '€3,000 relocation package, but it is a contractor agreement with a 3-month trial. '
              'In Lisbon I have my partner (she can move no earlier than in six months), parents and '
              'friends, and my own flat with no mortgage. My current job is stable, but I have not '
              'grown for two years. Should I relocate or stay?',
    },
    'launch': {
        'personas': ['logician', 'skeptic', 'creative', 'pragmatist'],
        'uk': 'Ми — команда з 4 людей, робимо SaaS для записів у барбершопи. Реліз запланований '
              'через тиждень, на нього чекають 120 барбершопів зі списку очікування. Відомі баги: '
              'зрідка дублюються нагадування клієнтам і повільно вантажиться календар на старих '
              'Android. Грошей вистачить на 5 місяців. Випускати зараз з відомими вадами чи '
              'відкласти реліз на місяць?',
        'en': 'We are a team of 4 building a booking SaaS for barbershops. Launch is planned in a '
              'week, and 120 barbershops on the waitlist are expecting it. Known bugs: client '
              'reminders are occasionally duplicated and the calendar loads slowly on old Android '
              'phones. We have 5 months of runway. Ship now with known flaws or delay the release '
              'by a month?',
    },
    'masters': {
        'personas': ['logician', 'emotional', 'skeptic', 'creative'],
        'uk': 'Мені 22, щойно закінчила бакалаврат з економіки. Маю два варіанти: магістратура '
              'з data science у Празі (2 роки, грант покриває навчання, але не житло — це близько '
              '600 € на місяць) або позиція junior-аналітика в київській фінтех-компанії з '
              'зарплатою 1200 $. Мрію згодом працювати аналітиком у міжнародній компанії. Що '
              'обрати: магістратуру зараз чи досвід?',
        'en': 'I am 22 and just finished a bachelor\'s in economics. Two options: a master\'s in '
              'data science in Prague (2 years, a grant covers tuition but not living costs — about '
              '€600 a month) or a junior analyst job at a fintech company at home paying $1,200 a '
              'month. Later I want to work as an analyst at an international company. Master\'s '
              'now or experience first?',
    },
    'freelance': {
        'personas': ['logician', 'emotional', 'skeptic', 'pragmatist'],
        'uk': 'Мені 34, я UX-дизайнерка в агенції, 7 років досвіду. Вигоряю: постійні '
              'переробки, і мене не підвищують. Маю 2 постійних фриланс-клієнтів, які дають '
              'близько 40% моєї зарплати, і заощадження на 8 місяців життя. Дітей немає, '
              'партнер працює. Звільнитися й піти у фриланс зараз чи спершу набрати більше '
              'клієнтів, лишаючись в агенції?',
        'en': 'I am 34, a UX designer at an agency with 7 years of experience. I am burning out: '
              'constant overtime and no promotion. I have 2 regular freelance clients who bring '
              'about 40% of my salary, and savings for 8 months. No kids, my partner works. Quit '
              'and go freelance now, or first build up more clients while staying at the agency?',
    },
}


class Command(BaseCommand):
    help = 'Проганяє приклади дискусій для галереї й зберігає їх у frontend/public/examples.'

    def add_arguments(self, parser):
        parser.add_argument('slugs', nargs='*', help=f'Теми: {", ".join(EXAMPLES)}. Без них — усі.')
        parser.add_argument('--force', action='store_true', help='Перезаписати наявні файли.')
        parser.add_argument('--out', default=str(OUT), help='Куди зберігати JSON.')

    def handle(self, *args, slugs, force, out, **options):
        unknown = set(slugs) - set(EXAMPLES)
        if unknown:
            raise CommandError(f'Невідомі теми: {", ".join(sorted(unknown))}')
        out = Path(out)
        out.mkdir(parents=True, exist_ok=True)
        User = get_user_model()
        user, _ = User.objects.get_or_create(email=SERVICE_EMAIL, defaults={'name': 'Clarity'})
        user.email_verified = True
        user.save(update_fields=['email_verified'])
        try:
            # синхронний раннер і без лімітів: команда сама чекає кожну дискусію до кінця
            with override_settings(
                DISCUSSION_RUNNER_SYNC=True,
                DISCUSSION_DAILY_LIMIT=0,
                DISCUSSION_DAILY_ADVANCE_LIMIT=0,
                REQUIRE_EMAIL_VERIFICATION=False,
                ALLOWED_HOSTS=['*'],
            ):
                for slug in slugs or EXAMPLES:
                    for lang in ('uk', 'en'):
                        self.run_one(user, slug, lang, out / f'{slug}.{lang}.json', force)
        finally:
            user.delete()

    def run_one(self, user, slug, lang, target, force):
        if target.exists() and not force:
            self.stdout.write(f'{target.name}: вже є (--force, щоб перезаписати)')
            return
        spec = EXAMPLES[slug]
        client = APIClient(HTTP_X_REQUESTED_WITH='XMLHttpRequest', HTTP_ACCEPT_LANGUAGE=lang)
        client.force_authenticate(user)
        created = client.post(
            '/api/discussions/',
            {'question': spec[lang], 'personas': spec['personas'], 'rounds': 2},
            format='json',
        )
        if created.status_code != 201:
            raise CommandError(f'{slug}/{lang}: {created.status_code} {getattr(created, "data", "")}')
        pk = created.data['id']
        for _ in range(6):
            client.post(f'/api/discussions/{pk}/run/')
            discussion = Discussion.objects.get(pk=pk)
            if discussion.awaiting_clarification:
                # приклад самодостатній: питання вже містить контекст, уточнення пропускаємо
                client.post(f'/api/discussions/{pk}/clarify/', {'answers': []}, format='json')
                continue
            if discussion.phase == Discussion.Phase.DONE or discussion.status == Discussion.Status.FAILED:
                break
        discussion = Discussion.objects.get(pk=pk)
        if discussion.phase != Discussion.Phase.DONE:
            self.stderr.write(f'{slug}/{lang}: не завершилась ({discussion.status}, {discussion.error_code})')
            return
        target.write_bytes(JSONRenderer().render(SharedDiscussionSerializer(discussion).data))
        self.stdout.write(f'{target.name}: {discussion.messages.count()} реплік')
