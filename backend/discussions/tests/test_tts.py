import base64
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from discussions import tts


def _quota_reply():
    reply = mock.Mock(status_code=429)
    reply.json.return_value = {'error': {'details': [{'retryDelay': '3600s'}]}}
    return reply


def _gemini_reply(audio, mime):
    reply = mock.Mock(status_code=200)
    reply.raise_for_status.return_value = None
    reply.json.return_value = {
        'candidates': [{'content': {'parts': [{'inlineData': {
            'mimeType': mime, 'data': base64.b64encode(audio).decode(),
        }}]}}],
    }
    return reply


class SpeechApiTests(TestCase):
    def setUp(self):
        cache.clear()
        tts._cache.clear()
        tts._exhausted_until.clear()
        user = get_user_model().objects.create_user(email='v@test.com', name='Голос', password='pass123!A')
        self.client = APIClient()
        self.client.force_authenticate(user)

    @override_settings(LLM_GEMINI_API_KEY='server-key')
    def test_reads_a_reply_in_the_role_voice_as_wav(self):
        with mock.patch.object(tts.httpx, 'post', return_value=_gemini_reply(b'\0\0' * 10, 'audio/L16;codec=pcm;rate=24000')) as post:
            res = self.client.post('/api/tts/', {'text': 'Перевірмо цифри.', 'voice': 'skeptic'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Content-Type'], 'audio/wav')
        self.assertEqual(res.content[:4], b'RIFF')
        payload = post.call_args.kwargs['json']
        voice = payload['generationConfig']['speechConfig']['voiceConfig']['prebuiltVoiceConfig']['voiceName']
        self.assertEqual(voice, 'Alnilam')
        self.assertEqual(payload['contents'][0]['parts'][0]['text'], 'Перевірмо цифри.')

    @override_settings(LLM_GEMINI_API_KEY='')
    def test_without_a_key_the_browser_voice_takes_over(self):
        res = self.client.post('/api/tts/', {'text': 'Привіт', 'voice': 'moderator'}, format='json')
        self.assertEqual(res.status_code, 503)

    def test_custom_roles_keep_a_steady_voice(self):
        self.assertEqual(tts.voice_for('my-role'), tts.voice_for('my-role'))

    @override_settings(LLM_GEMINI_API_KEY='server-key')
    def test_falls_back_to_another_model_when_the_daily_quota_is_spent(self):
        replies = [_quota_reply(), _gemini_reply(b'RIFF' + b'\0' * 40, 'audio/wav')]
        with mock.patch.object(tts.httpx, 'post', side_effect=replies) as post:
            res = self.client.post('/api/tts/', {'text': 'Раз', 'voice': 'devil'}, format='json')
        self.assertEqual(res.status_code, 200)
        first, second = (call.args[0] for call in post.call_args_list)
        self.assertNotEqual(first, second)
        # вичерпану модель далі не чіпаємо, а повтор репліки береться з кешу
        with mock.patch.object(tts.httpx, 'post') as post:
            self.client.post('/api/tts/', {'text': 'Раз', 'voice': 'devil'}, format='json')
        post.assert_not_called()

    @override_settings(LLM_GEMINI_API_KEY='server-key')
    def test_all_models_on_quota_is_reported_as_429(self):
        with mock.patch.object(tts.httpx, 'post', side_effect=lambda *a, **k: _quota_reply()):
            res = self.client.post('/api/tts/', {'text': 'Два', 'voice': 'devil'}, format='json')
        self.assertEqual(res.status_code, 429)

    @override_settings(LLM_GEMINI_API_KEY='server-key')
    def test_a_hanging_model_is_skipped(self):
        replies = [tts.httpx.ReadTimeout('slow'), _gemini_reply(b'RIFF' + b'\0' * 40, 'audio/wav')]
        with mock.patch.object(tts.httpx, 'post', side_effect=replies):
            res = self.client.post('/api/tts/', {'text': 'Три', 'voice': 'skeptic'}, format='json')
        self.assertEqual(res.status_code, 200)
