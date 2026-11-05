"""«Знайшли баги?»: звернення від людей і гостей, приватність і лист команді."""

from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from discussions.models import Discussion, Message
from support.models import BugReport
from support.serializers import clean_context, clean_page

User = get_user_model()
URL = '/api/support/reports/'


class BugReportApiTests(TestCase):
    def setUp(self):
        patcher = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request', return_value=True
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user(email='bug@test.com', name='Тест', password='pass123!A')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_signed_in_report_with_reply_permission(self):
        response = self.client.post(URL, {
            'kind': 'bug',
            'description': 'Кнопка «Надіслати» не реагує після вставки тексту',
            'page': '/chat/123?tab=x#y',
            'reply_to_account': True,
        }, format='json')
        self.assertEqual(response.status_code, 201)
        report = BugReport.objects.get()
        self.assertEqual(response.data['reference'], report.reference)
        self.assertEqual(len(report.reference), 8)
        self.assertEqual(report.user, self.user)
        self.assertEqual(report.contact_email, 'bug@test.com')
        self.assertEqual(report.page, '/chat/123')

    def test_signed_in_report_without_reply_keeps_email_private(self):
        self.client.post(URL, {
            'description': 'Щось дивне з історією дискусій',
            'email': 'someone@else.com',
        }, format='json')
        self.assertEqual(BugReport.objects.get().contact_email, '')

    def test_guest_can_report_with_optional_email(self):
        response = APIClient().post(URL, {
            'kind': 'idea',
            'description': 'Додайте, будь ласка, темну тему на лендинг',
            'email': 'guest@example.com',
        }, format='json')
        self.assertEqual(response.status_code, 201)
        report = BugReport.objects.get()
        self.assertIsNone(report.user)
        self.assertEqual(report.contact_email, 'guest@example.com')

    def test_too_short_description_is_rejected(self):
        response = self.client.post(URL, {'description': 'баг'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('description', response.data)
        self.assertFalse(BugReport.objects.exists())

    def test_honeypot_pretends_success_and_saves_nothing(self):
        response = APIClient().post(URL, {
            'description': 'Buy cheap watches here now!!!', 'website': 'https://spam.example',
        }, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertFalse(BugReport.objects.exists())

    def test_only_own_discussion_and_its_message_are_attached(self):
        own = Discussion.objects.create(user=self.user, question='Моє питання', personas=[])
        message = Message.objects.create(
            discussion=own, seq=1, phase='debate', role='ai', persona_slug='logic',
            persona_name='Логік', avatar='', content='Відповідь',
        )
        stranger = User.objects.create_user(email='x@test.com', name='X', password='pass123!A')
        foreign = Discussion.objects.create(user=stranger, question='Чуже', personas=[])

        self.client.post(URL, {
            'kind': 'ai_answer', 'description': 'Логік переплутав цифри у відповіді',
            'discussion': str(own.pk), 'message': str(message.pk),
        }, format='json')
        self.client.post(URL, {
            'description': 'Спроба додати чужу дискусію', 'discussion': str(foreign.pk),
        }, format='json')
        first, second = BugReport.objects.order_by('created_at')
        self.assertEqual(first.discussion, own)
        self.assertEqual(first.message, message)
        self.assertIsNone(second.discussion)

    def test_guest_cannot_attach_discussion(self):
        own = Discussion.objects.create(user=self.user, question='Моє питання', personas=[])
        APIClient().post(URL, {
            'description': 'Гість намагається додати дискусію', 'discussion': str(own.pk),
        }, format='json')
        self.assertIsNone(BugReport.objects.get().discussion)

    @override_settings(BUG_REPORT_EMAIL='team@clarity.test')
    def test_team_gets_email(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(URL, {
                'description': 'Падає сторінка налаштувань',
                'context': {'user_agent': 'Firefox', 'errors': [{'kind': 'error', 'message': 'boom'}]},
            }, format='json')
        self.assertEqual(len(mail.outbox), 1)
        letter = mail.outbox[0]
        self.assertEqual(letter.to, ['team@clarity.test'])
        self.assertIn(BugReport.objects.get().reference, letter.subject)
        self.assertIn('Падає сторінка налаштувань', letter.body)
        self.assertIn('boom', letter.body)

    @override_settings(BUG_REPORT_EMAIL='')
    def test_no_email_without_address(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(URL, {'description': 'Падає сторінка налаштувань'}, format='json')
        self.assertEqual(mail.outbox, [])

    def test_reports_are_deleted_with_account(self):
        self.client.post(URL, {'description': 'Падає сторінка налаштувань'}, format='json')
        self.user.delete()
        self.assertFalse(BugReport.objects.exists())


class CleaningTests(TestCase):
    def test_context_keeps_only_known_fields_and_clips(self):
        context = clean_context({
            'user_agent': 'A' * 1000,
            'theme': 'dark',
            'cookies': 'secret',
            'online': True,
            'errors': [{'message': 'x' * 500, 'stack': 'secret'}, 'junk', {'kind': 'empty'}],
        })
        self.assertEqual(len(context['user_agent']), 400)
        self.assertEqual(context['theme'], 'dark')
        self.assertNotIn('cookies', context)
        self.assertTrue(context['online'])
        self.assertEqual(len(context['errors']), 1)
        self.assertEqual(len(context['errors'][0]['message']), 300)
        self.assertNotIn('stack', context['errors'][0])
        self.assertEqual(clean_context('nope'), {})

    def test_page_drops_tokens(self):
        self.assertEqual(clean_page('https://x.test/settings?tab=privacy#k'), '/settings')
        self.assertEqual(clean_page('/reset-password/abc/def-token'), '/reset-password/…')
        self.assertEqual(clean_page('/shared/11111111-2222'), '/shared/…')
