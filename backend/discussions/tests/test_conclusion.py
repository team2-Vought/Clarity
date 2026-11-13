"""Висновок, уточнення модератора й уроки з журналу рішень."""

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from backend.i18n import using
from discussions.models import Decision, Discussion
from discussions.services.engine.parsing import normalize_clarify, normalize_summary
from discussions.services.engine.texts import _final_text
from discussions.services.prompts.profile import profile_block

User = get_user_model()


class SummaryTests(SimpleTestCase):
    def test_new_fields_are_kept_and_risks_get_a_plain_list_too(self):
        summary = normalize_summary(
            {
                'headline': 'Так, але лише з вестингом',
                'decision': 'Іти в стартап.',
                'conditions': ['Лише якщо частка має вестинг'],
                'risks': [
                    {'risk': 'Стартап закриється', 'mitigation': 'Тримати подушку на 8 місяців'},
                    'Вигорання',
                ],
                'unknowns': [{'question': 'Скільки грошей у стартапу', 'how': 'Спитати в друга про runway'}],
                'plan_b': 'Якщо за пів року немає росту — повернутися в QA.',
            },
            {},
            'open',
            [],
        )
        self.assertEqual(summary['headline'], 'Так, але лише з вестингом')
        self.assertEqual(summary['conditions'], ['Лише якщо частка має вестинг'])
        self.assertEqual(
            summary['risk_plan'],
            [
                {'risk': 'Стартап закриється', 'mitigation': 'Тримати подушку на 8 місяців'},
                {'risk': 'Вигорання', 'mitigation': ''},
            ],
        )
        # старі читачі (дерево, експорт) бачать ризики звичайним списком
        self.assertEqual(summary['risks'], ['Стартап закриється', 'Вигорання'])
        self.assertEqual(summary['unknowns'][0]['how'], 'Спитати в друга про runway')
        self.assertIn('повернутися в QA', summary['plan_b'])

        text = _final_text(summary)
        self.assertIn('**Так, але лише з вестингом**', text)
        self.assertIn('Стартап закриється — Тримати подушку', text)
        self.assertIn('План Б', text)

    def test_old_style_reply_still_works(self):
        summary = normalize_summary({'decision': 'Ні.', 'risks': ['Дорого']}, {}, 'open', [])
        self.assertEqual(summary['risks'], ['Дорого'])
        self.assertEqual(summary['headline'], '')
        self.assertEqual(summary['unknowns'], [])


class ClarifyTests(SimpleTestCase):
    def test_why_is_kept_and_questions_without_options_are_open(self):
        result = normalize_clarify({
            'ready': False,
            'questions': [
                {'question': 'Чи є вестинг?', 'why': 'Без нього частка може зникнути.', 'options': ['Так', 'Ні', 'Не знаю']},
                {'question': 'Скільки місяців runway?', 'options': []},
            ],
        })
        self.assertFalse(result['ready'])
        self.assertEqual(result['questions'][0]['why'], 'Без нього частка може зникнути.')
        self.assertEqual(result['questions'][1]['options'], [])


class HistoryTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='history@test.com', name='Оксана', password='pass123!A')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def decision(self, **extra):
        values = {
            'user': self.user,
            'question': 'Чи брати іпотеку?',
            'decision': 'Орендувати ще рік',
            'check_at': timezone.now(),
        }
        values.update(extra)
        return Decision.objects.create(**values)

    def create(self, **extra):
        return self.client.post(
            '/api/discussions/',
            {'question': 'Чи купувати квартиру зараз?', 'personas': ['logician', 'skeptic'], **extra},
            format='json',
        )

    def test_reviewed_decisions_go_into_the_new_discussion(self):
        self.decision(outcome='bad', reflection='Ціни виросли швидше', reviewed_at=timezone.now())
        self.decision(question='Не підсумоване')
        response = self.create()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['history_used'], 1)
        # профілю «Про мене» немає — показуємо лише історію
        self.assertFalse(response.data['profile_used'])
        discussion = Discussion.objects.get(pk=response.data['id'])
        block = profile_block(discussion.profile)
        self.assertIn('<user_history>', block)
        self.assertIn('Ціни виросли швидше', block)
        self.assertIn('вийшло погано', block)
        self.assertNotIn('Не підсумоване', block)

    def test_turning_the_profile_off_hides_history_too(self):
        self.decision(outcome='good', reviewed_at=timezone.now())
        response = self.create(use_profile=False)
        self.assertEqual(response.data['history_used'], 0)

    def test_history_block_in_english(self):
        with using('en'):
            block = profile_block({'history': [{'question': 'Q', 'decision': 'D', 'outcome': 'good'}]})
        self.assertIn('Outcome: went well.', block)


class CompareAndClarifyTests(SimpleTestCase):
    def test_compare_keeps_real_options_in_their_order(self):
        summary = normalize_summary(
            {
                'answer': 'Львів',
                'decision': 'Львів.',
                'compare': [
                    {'option': 'львів', 'pro': 'Дешевше', 'con': 'Далі від рідних'},
                    {'option': 'Київ', 'pro': 'Більше роботи', 'con': 'Дорога оренда'},
                    {'option': 'Одеса', 'pro': 'Море', 'con': '—'},
                ],
            },
            {},
            'choose_one',
            ['Київ', 'Львів'],
        )
        self.assertEqual([row['option'] for row in summary['compare']], ['Київ', 'Львів'])
        self.assertEqual(summary['compare'][1]['con'], 'Далі від рідних')
        self.assertIn('Порівняння варіантів', _final_text(summary))

    def test_other_option_added_by_the_model_is_dropped(self):
        result = normalize_clarify({
            'ready': False,
            'questions': [{'question': 'Яка мета?', 'options': ['Стати PM', 'Лишитися в QA', 'Інше']}],
        })
        self.assertEqual(result['questions'][0]['options'], ['Стати PM', 'Лишитися в QA'])


class RevisitTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='revisit@test.com', name='Оксана', password='pass123!A')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.entry = Decision.objects.create(
            user=self.user, question='Чи брати іпотеку?', decision='Орендувати', check_at=timezone.now()
        )

    def test_revisit_links_the_new_discussion_to_the_journal_entry(self):
        response = self.client.post(
            '/api/discussions/',
            {'question': 'Повертаюся до рішення про іпотеку', 'personas': ['logician', 'skeptic'],
             'revisit_of': str(self.entry.id)},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(str(response.data['revisit']['id']), str(self.entry.id))
        journal = self.client.get('/api/journal/').data['results']
        self.assertEqual(str(journal[0]['revisits'][0]['id']), response.data['id'])

    def test_someone_elses_entry_is_ignored(self):
        other = User.objects.create_user(email='other@test.com', name='Інша', password='pass123!A')
        foreign = Decision.objects.create(user=other, question='?', decision='!', check_at=timezone.now())
        response = self.client.post(
            '/api/discussions/',
            {'question': 'Повертаюся до чужого рішення', 'personas': ['logician', 'skeptic'],
             'revisit_of': str(foreign.id)},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.data['revisit'])
