from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.db.models import QuerySet
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from discussions.models import Decision, Discussion
from discussions.services import reminders
from discussions.services.reminders import send_due_reminders

User = get_user_model()

SUMMARY = {
    'decision': 'Переїжджати до Києва',
    'confirmed': True,
    'recommendation': 'Порахувати бюджет',
    'next_steps': ['Порахувати бюджет', 'Подзвонити рієлтору'],
    'change_triggers': ['Якщо оренда дорожча за 20 000 — переглянути'],
}


@override_settings(FRONTEND_URL='https://clarity.test')
class JournalTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email='journal@test.com', name='Оксана', password='pass123!A')
        self.client.force_authenticate(self.user)
        self.discussion = self.make_discussion()

    def make_discussion(self, user=None, finished=True):
        return Discussion.objects.create(
            user=user or self.user,
            question='Чи переїжджати до Києва?',
            personas=['logician', 'skeptic'],
            phase=Discussion.Phase.DONE if finished else Discussion.Phase.DEBATE,
            status=Discussion.Status.DONE if finished else Discussion.Status.IN_PROGRESS,
            final_summary=SUMMARY if finished else None,
        )

    def record(self, discussion=None, **extra):
        return self.client.post(
            '/api/journal/',
            {
                'discussion': str((discussion or self.discussion).pk),
                'decision': 'Переїжджаю в березні',
                'remind_in_days': 30,
                **extra,
            },
            format='json',
        )

    def test_recording_copies_the_plan_and_sets_the_reminder(self):
        response = self.record()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['steps'], SUMMARY['next_steps'])
        self.assertEqual(response.data['triggers'], SUMMARY['change_triggers'])
        self.assertEqual(response.data['status'], 'waiting')
        days = (Decision.objects.get().check_at - timezone.now()).days
        self.assertIn(days, (29, 30))
        chat = self.client.get(f'/api/discussions/{self.discussion.pk}/').data
        self.assertEqual(chat['journal']['status'], 'waiting')

    def test_recording_again_updates_the_same_entry(self):
        self.record()
        response = self.record(decision='Лишаюсь у Львові', remind_in_days=7)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Decision.objects.count(), 1)
        self.assertEqual(Decision.objects.get().decision, 'Лишаюсь у Львові')

    def test_only_own_finished_discussions(self):
        self.assertEqual(self.record(self.make_discussion(finished=False)).status_code, 400)
        stranger = User.objects.create_user(email='other@test.com', name='Інший', password='pass123!A')
        self.assertEqual(self.record(self.make_discussion(user=stranger)).status_code, 404)

    def test_due_entry_is_reviewed_and_history_kept(self):
        entry_id = self.record().data['id']
        Decision.objects.filter(pk=entry_id).update(check_at=timezone.now() - timedelta(minutes=1))
        due = self.client.get('/api/journal/due/').data
        self.assertEqual(due['count'], 1)
        self.assertEqual(str(due['next']['id']), str(entry_id))

        response = self.client.patch(
            f'/api/journal/{entry_id}/',
            {'outcome': 'good', 'reflection': 'Варто було раніше', 'done_steps': [0, 1, 7]},
            format='json',
        )
        self.assertEqual(response.data['status'], 'reviewed')
        self.assertEqual(response.data['done_steps'], [0, 1])
        self.assertEqual(self.client.get('/api/journal/due/').data['count'], 0)

    def test_snooze_moves_the_question_later(self):
        entry_id = self.record().data['id']
        Decision.objects.filter(pk=entry_id).update(check_at=timezone.now() - timedelta(days=1))
        response = self.client.patch(f'/api/journal/{entry_id}/', {'remind_in_days': 7}, format='json')
        self.assertEqual(response.data['status'], 'waiting')

    def test_entry_outlives_its_discussion(self):
        self.record()
        self.discussion.delete()
        entries = self.client.get('/api/journal/').data['results']
        self.assertEqual(len(entries), 1)
        self.assertIsNone(entries[0]['discussion_id'])
        self.assertEqual(entries[0]['question'], 'Чи переїжджати до Києва?')

    def test_reminder_email_is_sent_once_in_the_discussion_language(self):
        entry_id = self.record().data['id']
        Decision.objects.filter(pk=entry_id).update(check_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(send_due_reminders(), 1)
        self.assertEqual(send_due_reminders(), 0)
        letter = mail.outbox[0]
        self.assertEqual(letter.to, ['journal@test.com'])
        self.assertIn('Як ваше рішення?', letter.subject)
        self.assertIn('«Переїжджаю в березні»', letter.body)
        self.assertIn(f'https://clarity.test/journal?review={entry_id}', letter.body)

    def test_two_workers_send_one_email(self):
        entry_id = self.record().data['id']
        Decision.objects.filter(pk=entry_id).update(check_at=timezone.now() - timedelta(minutes=1))
        # другий воркер вибрав записи ще до того, як перший надіслав лист
        stale = list(Decision.objects.filter(pk=entry_id).select_related('user'))
        self.assertEqual(send_due_reminders(), 1)
        with mock.patch.object(QuerySet, 'select_related', autospec=True, return_value=stale):
            self.assertEqual(send_due_reminders(), 0)
        self.assertEqual(len(mail.outbox), 1)

    def test_failed_email_is_retried_later(self):
        entry_id = self.record().data['id']
        Decision.objects.filter(pk=entry_id).update(check_at=timezone.now() - timedelta(minutes=1))
        with mock.patch.object(reminders, 'send_mail', side_effect=OSError('smtp down')):
            self.assertEqual(send_due_reminders(), 0)
        self.assertIsNone(Decision.objects.get(pk=entry_id).reminded_at)
        self.assertEqual(send_due_reminders(), 1)

    def test_no_email_when_turned_off(self):
        self.client.patch('/api/settings/', {'preferences': {'journal_emails': False}}, format='json')
        entry_id = self.record().data['id']
        Decision.objects.filter(pk=entry_id).update(check_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(send_due_reminders(), 0)
        self.assertEqual(mail.outbox, [])
        # в застосунку нагадування лишається
        self.assertEqual(self.client.get('/api/journal/due/').data['count'], 1)
