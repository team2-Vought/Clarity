"""Публічне посилання без особистого, ліміти вкладень, розмір запиту, потоки раннера."""

import uuid
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from discussions.models import Attachment, Discussion, Message
from discussions.services import pdf_text, runner

from .test_attachments import PDF

User = get_user_model()


class SharedPrivacyTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='share@test.com', name='Оксана', password='pass123!A')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.discussion = Discussion.objects.create(
            user=self.user,
            question='Чи переїжджати до Києва?',
            personas=['logician', 'skeptic'],
            clarifications=[{'question': 'Який у вас бюджет?', 'answer': 'Борг 200 000 грн, двоє дітей'}],
        )
        for seq, content in ((1, 'Чи переїжджати до Києва?'), (5, 'Мені 52 роки, це важливо?')):
            self.discussion.messages.create(
                seq=seq,
                phase=Discussion.Phase.OPENING,
                role=Message.Role.USER,
                persona_slug='user',
                persona_name='Оксана',
                avatar='🧑',
                content=content,
            )

    def shared(self, **payload):
        token = self.client.post(
            f'/api/discussions/{self.discussion.pk}/share/', payload, format='json'
        ).data['share_token']
        return APIClient().get(f'/api/shared/{token}/').data

    def test_personal_answers_are_hidden_by_default(self):
        data = self.shared()
        self.assertEqual(data['clarifications'], [])
        contents = [message['content'] for message in data['messages']]
        self.assertEqual(contents[0], 'Чи переїжджати до Києва?')
        self.assertNotIn('52', ' '.join(contents))
        self.assertNotIn('200 000', str(data))

    def test_author_can_choose_to_show_them(self):
        data = self.shared(personal=True)
        self.assertEqual(data['clarifications'][0]['answer'], 'Борг 200 000 грн, двоє дітей')
        self.assertIn('Мені 52 роки, це важливо?', [m['content'] for m in data['messages']])
        # повторне створення без згоди знову ховає особисте
        self.assertEqual(self.shared()['clarifications'], [])


@override_settings(ATTACHMENTS_PENDING_MAX=2)
class AttachmentAbuseTests(TestCase):
    def setUp(self):
        throttle = mock.patch('rest_framework.throttling.SimpleRateThrottle.allow_request', return_value=True)
        throttle.start()
        self.addCleanup(throttle.stop)
        self.user = User.objects.create_user(email='files@test.com', name='Оксана', password='pass123!A')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def upload(self, name='note.txt', data=b'hello'):
        return self.client.post(
            '/api/attachments/', {'file': SimpleUploadedFile(name, data)}, format='multipart'
        )

    def test_unattached_files_are_capped(self):
        self.assertEqual(self.upload().status_code, 201)
        self.assertEqual(self.upload().status_code, 201)
        response = self.upload()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.data['code'], 'attachments_pending')
        self.assertEqual(Attachment.objects.count(), 2)

    def test_oversized_request_is_rejected_before_reading(self):
        response = self.client.generic(
            'POST', '/api/attachments/', b'x', content_type='text/plain', CONTENT_LENGTH=str(50 * 1024 * 1024)
        )
        self.assertEqual(response.status_code, 413)

    def test_pdf_is_read_in_a_separate_process(self):
        error, pages = pdf_text.extract_pages(PDF, timeout=30, max_pages=5)
        self.assertIsNone(error)
        self.assertIn('Salary', pages[0])

    def test_slow_pdf_gives_up(self):
        error, _ = pdf_text.extract_pages(PDF, timeout=0, max_pages=5)
        self.assertEqual(error, pdf_text.TIMEOUT)
        with mock.patch.object(pdf_text, 'extract_pages', return_value=(pdf_text.TIMEOUT, None)):
            response = self.upload('big.pdf', PDF)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'pdf_timeout')


@override_settings(DISCUSSION_RUNNER='thread', DISCUSSION_RUNNER_SYNC=False, DISCUSSION_THREAD_MAX=1)
class ThreadLimitTests(TestCase):
    def test_no_more_threads_than_the_limit(self):
        with runner._active_lock:
            runner._active.add('busy')
        self.addCleanup(runner._active.discard, 'busy')
        with mock.patch.object(runner.threading, 'Thread') as thread:
            self.assertFalse(runner.start(uuid.uuid4()))
        thread.assert_not_called()
