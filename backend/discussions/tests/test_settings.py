from unittest import mock

import httpx
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import ProviderKey
from accounts.secrets import decrypt
from discussions.services import catalog
from discussions.services.providers import get_provider

User = get_user_model()

NO_SERVER_KEYS = {
    'LLM_OPENAI_API_KEY': '',
    'LLM_ANTHROPIC_API_KEY': '',
    'LLM_GEMINI_API_KEY': '',
    'LLM_GROQ_API_KEY': '',
    'LLM_CEREBRAS_API_KEY': '',
    'LLM_DEEPSEEK_API_KEY': '',
    'LLM_MISTRAL_API_KEY': '',
    'LLM_OPENROUTER_API_KEY': '',
    'LLM_OLLAMA_MODELS': '',
    'LLM_CUSTOM_MODEL': '',
}


@override_settings(**NO_SERVER_KEYS, API_KEYS_VERIFY=False)
class SettingsApiTests(TestCase):
    def setUp(self):
        patcher = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request',
            return_value=True,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user(email='s@test.com', name='Тест', password='pass123!A')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def provider(self, data, provider_id):
        return next(item for item in data['providers'] if item['id'] == provider_id)

    def test_requires_auth(self):
        response = APIClient().get('/api/settings/')
        self.assertEqual(response.status_code, 401)

    def test_defaults(self):
        response = self.client.get('/api/settings/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['preferences']['default_mode'], 'open')
        self.assertTrue(response.data['preferences']['web_search'])
        groq = self.provider(response.data, 'groq')
        self.assertFalse(groq['available'])
        self.assertTrue(groq['accepts_key'])
        self.assertFalse(self.provider(response.data, 'ollama')['accepts_key'])

    def test_saved_key_is_encrypted_masked_and_unlocks_models(self):
        response = self.client.put(
            '/api/settings/keys/groq/', {'key': 'gsk_abcdefghijklmnop1234'}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        groq = self.provider(response.data, 'groq')
        self.assertTrue(groq['available'])
        self.assertTrue(groq['user_key'])
        self.assertEqual(groq['masked'], 'gsk…1234')
        self.assertNotIn('gsk_abcdefghijklmnop1234', str(response.data))

        stored = ProviderKey.objects.get(user=self.user, provider='groq')
        self.assertNotIn('abcdefghijklmnop', stored.encrypted_key)
        self.assertEqual(decrypt(stored.encrypted_key), 'gsk_abcdefghijklmnop1234')

        models = self.client.get('/api/models/').data
        groq_models = [m for m in models['models'] if m['provider_id'] == 'groq']
        self.assertTrue(groq_models and all(m['available'] for m in groq_models))

    def test_key_is_private_to_its_owner(self):
        self.client.put('/api/settings/keys/groq/', {'key': 'gsk_abcdefghijklmnop1234'}, format='json')
        other = User.objects.create_user(email='o@test.com', name='Інший', password='pass123!A')
        client = APIClient()
        client.force_authenticate(other)
        models = client.get('/api/models/').data
        self.assertFalse(any(m['available'] for m in models['models']))

    def test_user_key_reaches_provider(self):
        self.client.put('/api/settings/keys/groq/', {'key': 'gsk_abcdefghijklmnop1234'}, format='json')
        with catalog.user_context(self.user):
            provider = get_provider('groq:openai/gpt-oss-120b')
        self.assertEqual(provider.api_key, 'gsk_abcdefghijklmnop1234')
        # поза контекстом користувача ключа немає
        with self.assertRaises(Exception):
            get_provider('groq:openai/gpt-oss-120b')

    def test_delete_key(self):
        self.client.put('/api/settings/keys/groq/', {'key': 'gsk_abcdefghijklmnop1234'}, format='json')
        response = self.client.delete('/api/settings/keys/groq/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.provider(response.data, 'groq')['available'])
        self.assertFalse(ProviderKey.objects.exists())

    def test_rejects_garbage_and_unknown_provider(self):
        response = self.client.put('/api/settings/keys/groq/', {'key': 'short'}, format='json')
        self.assertEqual(response.status_code, 400)
        response = self.client.put('/api/settings/keys/groq/', {'key': 'has space inside 123'}, format='json')
        self.assertEqual(response.status_code, 400)
        response = self.client.put('/api/settings/keys/ollama/', {'key': 'abcdefghijkl'}, format='json')
        self.assertEqual(response.status_code, 404)

    @override_settings(API_KEYS_VERIFY=True)
    def test_rejected_key_is_not_saved(self):
        with mock.patch('discussions.account_settings.httpx.get') as get:
            get.return_value = httpx.Response(401, request=httpx.Request('GET', 'https://x'))
            response = self.client.put(
                '/api/settings/keys/openai/', {'key': 'sk-wrongwrongwrong'}, format='json'
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn('key', response.data)
        self.assertFalse(ProviderKey.objects.exists())

    @override_settings(API_KEYS_VERIFY=True)
    def test_unreachable_provider_still_saves(self):
        with mock.patch('discussions.account_settings.httpx.get', side_effect=httpx.ConnectError('down')):
            response = self.client.put(
                '/api/settings/keys/openai/', {'key': 'sk-goodgoodgoodgood'}, format='json'
            )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data['verified'])
        self.assertTrue(ProviderKey.objects.exists())

    def test_preferences(self):
        self.client.put('/api/settings/keys/groq/', {'key': 'gsk_abcdefghijklmnop1234'}, format='json')
        response = self.client.patch(
            '/api/settings/',
            {'preferences': {'default_model': 'groq:openai/gpt-oss-20b', 'default_rounds': 3, 'web_search': False}},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['preferences']['default_rounds'], 3)
        self.assertEqual(response.data['default_model'], 'groq:openai/gpt-oss-20b')
        models = self.client.get('/api/models/').data
        self.assertEqual(models['default_model'], 'groq:openai/gpt-oss-20b')
        self.assertFalse(models['preferences']['web_search'])

    def test_invalid_preferences(self):
        for bad in ({'default_rounds': 9}, {'default_model': 'nope:model'}, {'default_mode': 'x'}):
            response = self.client.patch('/api/settings/', {'preferences': bad}, format='json')
            self.assertEqual(response.status_code, 400, bad)
