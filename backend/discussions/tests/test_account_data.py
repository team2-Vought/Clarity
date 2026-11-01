"""Власні ключі й ліміти, експорт даних, відписка від листів, прев'ю посилання."""

import json
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import ProviderKey
from accounts.secrets import encrypt
from discussions.models import Decision, Discussion, Message
from discussions.services import reminders, usage

from .fakes import FakeProvider

User = get_user_model()

# лише ключ людини для Groq: серверних ключів немає, тож усе платить людина
ONLY_OWN_KEYS = {
    'LLM_DEFAULT_MODEL': 'groq:openai/gpt-oss-120b',
    'LLM_OPENAI_API_KEY': '',
    'LLM_ANTHROPIC_API_KEY': '',
    'LLM_GEMINI_API_KEY': '',
    'LLM_GROQ_API_KEY': '',
    'LLM_CEREBRAS_API_KEY': '',
    'LLM_DEEPSEEK_API_KEY': '',
    'LLM_MISTRAL_API_KEY': '',
    'LLM_OPENROUTER_API_KEY': '',
    'LLM_OLLAMA_MODELS': [],
    'LLM_CUSTOM_MODEL': '',
    'LLM_MODERATOR_MODEL': '',
    'LLM_DEVIL_MODEL': '',
    'DISCUSSION_RUNNER_SYNC': True,
    'DISCUSSION_DAILY_LIMIT': 1,
    'DISCUSSION_DAILY_ADVANCE_LIMIT': 1,
}


class ApiCase(TestCase):
    def setUp(self):
        throttle = mock.patch('rest_framework.throttling.SimpleRateThrottle.allow_request', return_value=True)
        throttle.start()
        self.addCleanup(throttle.stop)
        self.provider = FakeProvider()
        provider = mock.patch(
            'discussions.services.engine.calls.get_provider', side_effect=lambda model_id: self.provider
        )
        provider.start()
        self.addCleanup(provider.stop)
        self.user = User.objects.create_user(email='data@test.com', name='Оксана', password='pass123!A')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create(self, **extra):
        payload = {
            'question': 'Чи варто переходити на нову роботу?',
            'personas': ['logician', 'skeptic'],
            'rounds': 2,
            **extra,
        }
        return self.client.post('/api/discussions/', payload, format='json')


@override_settings(**ONLY_OWN_KEYS)
class OwnKeyLimitTests(ApiCase):
    def setUp(self):
        super().setUp()
        ProviderKey.objects.create(user=self.user, provider='groq', encrypted_key=encrypt('gsk-own'), masked='gsk…own')

    def test_own_keys_lift_the_daily_limits(self):
        first = self.create()
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data['billing'], 'own')
        # ліміт на одну дискусію й одну відповідь — а дискусій і відповідей більше
        second = self.create()
        self.assertEqual(second.status_code, 201, second.data)
        self.client.post(f'/api/discussions/{second.data["id"]}/run/')
        discussion = Discussion.objects.get(pk=second.data['id'])
        self.assertTrue(discussion.is_finished, discussion.error_public)
        today = usage.today(self.user)
        self.assertEqual((today.discussions, today.replies), (0, 0))

    @override_settings(LLM_OPENAI_API_KEY='sk-server')
    def test_server_model_is_shown_and_counted(self):
        created = self.create(personas=[{'slug': 'logician', 'model': 'openai:gpt-6-luna'}, 'skeptic'])
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data['billing'], 'mixed')
        self.assertEqual(usage.today(self.user).discussions, 1)


class ExportAndSessionsTests(ApiCase):
    def test_export_has_everything_but_secrets(self):
        ProviderKey.objects.create(user=self.user, provider='groq', encrypted_key=encrypt('gsk-secret'), masked='gsk…ret')
        discussion = Discussion.objects.create(user=self.user, question='Чи переїжджати?', personas=['logician'])
        discussion.messages.create(
            seq=1, phase='opening', role=Message.Role.USER, persona_slug='user',
            persona_name='Оксана', avatar='🧑', content='Чи переїжджати?',
        )
        response = self.client.get('/api/auth/export/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('attachment', response['Content-Disposition'])
        data = json.loads(response.content)
        self.assertEqual(data['account']['email'], 'data@test.com')
        self.assertEqual(data['discussions'][0]['messages'][0]['content'], 'Чи переїжджати?')
        self.assertEqual(data['api_keys'][0]['provider'], 'groq')
        self.assertNotIn('gsk-secret', response.content.decode())
        self.assertNotIn('encrypted_key', response.content.decode())

    def test_sessions_can_be_listed_and_signed_out(self):
        client = APIClient()
        for agent in ('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36', 'Mozilla/5.0 (iPhone) Safari/604.1'):
            client.post(
                '/api/auth/login/', {'email': 'data@test.com', 'password': 'pass123!A'},
                format='json', HTTP_USER_AGENT=agent,
            )
        sessions = client.get('/api/auth/sessions/').data
        self.assertEqual({s['device'] for s in sessions}, {'Chrome · Windows', 'Safari · iPhone'})
        self.assertEqual(sum(s['current'] for s in sessions), 1)
        other = next(s for s in sessions if not s['current'])
        response = client.delete(f'/api/auth/sessions/{other["id"]}/', HTTP_X_REQUESTED_WITH='XMLHttpRequest')
        self.assertEqual(response.status_code, 204)
        self.assertEqual(len(client.get('/api/auth/sessions/').data), 1)
        # чужий вхід видалити не можна
        stranger = User.objects.create_user(email='x@test.com', name='Інший', password='pass123!A')
        foreign = APIClient()
        foreign.force_authenticate(stranger)
        current = client.get('/api/auth/sessions/').data[0]
        self.assertEqual(foreign.delete(f'/api/auth/sessions/{current["id"]}/').status_code, 404)


@override_settings(FRONTEND_URL='https://clarity.test')
class UnsubscribeTests(ApiCase):
    def due_entry(self):
        discussion = Discussion.objects.create(user=self.user, question='Чи переїжджати?', personas=['logician'])
        return Decision.objects.create(
            user=self.user, discussion=discussion, question='Чи переїжджати?', decision='Переїжджаю',
            check_at=timezone.now() - timedelta(minutes=1),
        )

    def test_letter_has_one_click_unsubscribe(self):
        self.due_entry()
        self.assertEqual(reminders.send_due_reminders(), 1)
        letter = mail.outbox[0]
        header = letter.extra_headers['List-Unsubscribe']
        self.assertTrue(header.startswith('<https://clarity.test/api/journal/unsubscribe/'))
        self.assertEqual(letter.extra_headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
        self.assertIn('https://clarity.test/unsubscribe/', letter.body)

        one_click = header.strip('<>').replace('https://clarity.test', '')
        response = APIClient().post(one_click, 'List-Unsubscribe=One-Click', content_type='application/x-www-form-urlencoded')
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertFalse(self.user.preferences['journal_emails'])
        self.due_entry()
        self.assertEqual(reminders.send_due_reminders(), 0)

    def test_forged_link_does_nothing(self):
        response = APIClient().post('/api/journal/unsubscribe/forged/')
        self.assertEqual(response.status_code, 400)


class SharedPreviewTests(TestCase):
    def test_shared_page_has_open_graph_tags(self):
        user = User.objects.create_user(email='og@test.com', name='Оксана', password='pass123!A')
        discussion = Discussion.objects.create(
            user=user, question='Чи переїжджати до Києва <зараз>?', personas=['logician'],
            final_summary={'decision': 'Переїжджати навесні'}, share_token='6f1c1f7e-4a7e-4a55-9a59-111111111111',
        )
        response = self.client.get(f'/shared/{discussion.share_token}')
        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        self.assertIn('property="og:title" content="Чи переїжджати до Києва &lt;зараз&gt;?"', html)
        self.assertIn('Переїжджати навесні', html)
        self.assertIn('<div id="root">', html)
        self.assertEqual(response['Content-Security-Policy'], "frame-ancestors 'none'")

    def test_unknown_link_is_404_without_tags(self):
        response = self.client.get('/shared/6f1c1f7e-4a7e-4a55-9a59-000000000000')
        self.assertEqual(response.status_code, 404)
        self.assertNotIn('og:title', response.content.decode())
