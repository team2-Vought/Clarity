from unittest import mock

from django.test import SimpleTestCase, override_settings

from discussions.services.catalog import catalog
from discussions.services.providers import (
    AnthropicProvider,
    OpenAICompatibleProvider,
    ProviderError,
    get_provider,
)


def fake_response(payload, status_code=200):
    response = mock.Mock()
    response.status_code = status_code
    response.json.return_value = payload
    response.text = str(payload)
    return response


class ProviderTests(SimpleTestCase):
    @override_settings(LLM_OPENAI_API_KEY='sk-test')
    def test_openai_compatible_call(self):
        provider = get_provider('openai:gpt-6-luna')
        self.assertIsInstance(provider, OpenAICompatibleProvider)
        payload = {
            'choices': [{'message': {'content': 'Відповідь моделі'}}],
        }
        with mock.patch(
            'discussions.services.providers.httpx.post',
            return_value=fake_response(payload),
        ) as post:
            result = provider.complete(
                system='Системний промпт',
                prompt='Користувацький промпт',
                temperature=0.4,
            )
        self.assertEqual(result, 'Відповідь моделі')
        args, kwargs = post.call_args
        self.assertEqual(args[0], 'https://api.openai.com/v1/chat/completions')
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer sk-test')
        self.assertEqual(kwargs['json']['model'], 'gpt-6-luna')
        self.assertEqual(kwargs['json']['temperature'], 0.4)
        self.assertEqual(kwargs['json']['max_tokens'], 1600)
        self.assertEqual(kwargs['json']['messages'][0]['role'], 'system')
        self.assertEqual(kwargs['json']['messages'][1]['role'], 'user')

    @override_settings(LLM_ANTHROPIC_API_KEY='sk-ant-test')
    def test_anthropic_call(self):
        provider = get_provider('anthropic:claude-sonnet-5-5')
        self.assertIsInstance(provider, AnthropicProvider)
        payload = {
            'content': [
                {'type': 'thinking', 'thinking': '...'},
                {'type': 'text', 'text': 'Відповідь Claude'},
            ]
        }
        with mock.patch(
            'discussions.services.providers.httpx.post',
            return_value=fake_response(payload),
        ) as post:
            result = provider.complete(system='Система', prompt='Питання')
        self.assertEqual(result, 'Відповідь Claude')
        args, kwargs = post.call_args
        self.assertEqual(args[0], 'https://api.anthropic.com/v1/messages')
        self.assertEqual(kwargs['headers']['x-api-key'], 'sk-ant-test')
        self.assertEqual(kwargs['json']['model'], 'claude-sonnet-5-5')
        self.assertEqual(kwargs['json']['temperature'], 0.7)
        self.assertEqual(kwargs['json']['max_tokens'], 1600)

    @override_settings(LLM_OPENAI_API_KEY='')
    def test_missing_key_gives_clear_error(self):
        with self.assertRaises(ProviderError) as ctx:
            get_provider('openai:gpt-6-luna')
        self.assertIn('OPENAI_API_KEY', str(ctx.exception))

    def test_unknown_model_gives_clear_error(self):
        with self.assertRaises(ProviderError) as ctx:
            get_provider('unknown:model')
        self.assertIn('не знайдена', str(ctx.exception))

    @override_settings(
        LLM_OLLAMA_MODELS=['qwen3:8b'],
        LLM_OLLAMA_BASE_URL='http://localhost:11434/v1',
    )
    def test_ollama_provider_needs_no_key(self):
        provider = get_provider('ollama:qwen3:8b')
        self.assertIsInstance(provider, OpenAICompatibleProvider)
        self.assertEqual(provider.api_key, 'ollama')
        self.assertEqual(provider.base_url, 'http://localhost:11434/v1')

    @override_settings(LLM_OPENAI_API_KEY='sk-test')
    def test_api_error_is_reported(self):
        provider = get_provider('openai:gpt-6-luna')
        with mock.patch(
            'discussions.services.providers.httpx.post',
            return_value=fake_response({'error': 'unauthorized'}, status_code=401),
        ):
            with self.assertRaises(ProviderError) as ctx:
                provider.complete(system='s', prompt='p')
        self.assertIn('401', str(ctx.exception))

    @override_settings(
        LLM_GEMINI_API_KEY='',
        LLM_GROQ_API_KEY='gsk-test',
        LLM_DEFAULT_MODEL='openai:gpt-6-luna',
    )
    def test_catalog_falls_back_to_available_provider(self):
        data = catalog()
        available_ids = {
            item['id'] for item in data['models'] if item['available']
        }
        self.assertIn('groq:openai/gpt-oss-120b', available_ids)
        self.assertEqual(data['default_model'], 'groq:openai/gpt-oss-120b')
        self.assertNotIn('openai:gpt-6-luna', data['recommended'])
    @override_settings(
        LLM_OPENAI_API_KEY='sk-test',
        LLM_MAX_RETRIES=1,
        LLM_RETRY_DELAY_SECONDS=0,
        LLM_RETRY_MAX_DELAY_SECONDS=0,
    )
    def test_transient_error_is_retried(self):
        provider = get_provider('openai:gpt-6-luna')
        payload = {'choices': [{'message': {'content': 'Після повтору'}}]}
        with mock.patch(
            'discussions.services.providers.httpx.post',
            side_effect=[
                fake_response({'error': 'unavailable'}, status_code=503),
                fake_response(payload),
            ],
        ) as post:
            result = provider.complete(system='s', prompt='p')
        self.assertEqual(result, 'Після повтору')
        self.assertEqual(post.call_count, 2)

    @override_settings(
        LLM_OPENAI_API_KEY='sk-test',
        LLM_MAX_RETRIES=2,
        LLM_RETRY_DELAY_SECONDS=0,
        LLM_RETRY_MAX_DELAY_SECONDS=0,
    )
    def test_client_error_is_not_retried(self):
        provider = get_provider('openai:gpt-6-luna')
        with mock.patch(
            'discussions.services.providers.httpx.post',
            return_value=fake_response({'error': 'bad key'}, status_code=401),
        ) as post:
            with self.assertRaises(ProviderError):
                provider.complete(system='s', prompt='p')
        self.assertEqual(post.call_count, 1)


class JsonModeTests(SimpleTestCase):
    @override_settings(LLM_OPENAI_API_KEY='sk-test')
    def test_json_mode_sets_response_format(self):
        provider = get_provider('openai:gpt-6-luna')
        payload = {'choices': [{'message': {'content': '{"decision": "x"}'}}]}
        with mock.patch(
            'discussions.services.providers.httpx.post',
            return_value=fake_response(payload),
        ) as post:
            provider.complete(system='s', prompt='JSON', json_mode=True)
        self.assertEqual(
            post.call_args.kwargs['json']['response_format'],
            {'type': 'json_object'},
        )

    @override_settings(LLM_OPENAI_API_KEY='sk-test')
    def test_json_mode_falls_back_when_unsupported(self):
        provider = get_provider('openai:gpt-6-luna')
        ok = fake_response({'choices': [{'message': {'content': '{"decision": "x"}'}}]})
        rejected = fake_response({'error': 'response_format unsupported'}, status_code=400)
        with mock.patch(
            'discussions.services.providers.httpx.post',
            side_effect=[rejected, ok],
        ) as post:
            result = provider.complete(system='s', prompt='JSON', json_mode=True)
        self.assertEqual(result, '{"decision": "x"}')
        first, second = post.call_args_list
        self.assertIn('response_format', first.kwargs['json'])
        self.assertNotIn('response_format', second.kwargs['json'])

    @override_settings(LLM_OPENAI_API_KEY='sk-test')
    def test_plain_mode_has_no_response_format(self):
        provider = get_provider('openai:gpt-6-luna')
        payload = {'choices': [{'message': {'content': 'текст'}}]}
        with mock.patch(
            'discussions.services.providers.httpx.post',
            return_value=fake_response(payload),
        ) as post:
            provider.complete(system='s', prompt='p')
        self.assertNotIn('response_format', post.call_args.kwargs['json'])


class RateLimitRetryTests(SimpleTestCase):
    @override_settings(
        LLM_OPENAI_API_KEY='sk-test',
        LLM_RETRY_MAX_DELAY_SECONDS=6,
        LLM_RATE_LIMIT_MAX_DELAY_SECONDS=20,
    )
    def test_rate_limit_waits_longer_than_generic_cap(self):
        provider = get_provider('openai:gpt-6-luna')
        limited = fake_response({'error': 'tpm'}, status_code=429)
        limited.headers = {'Retry-After': '9.8'}
        ok = fake_response({'choices': [{'message': {'content': 'ok'}}]})
        with mock.patch(
            'discussions.services.providers.httpx.post',
            side_effect=[limited, ok],
        ), mock.patch('discussions.services.providers.time.sleep') as sleep:
            self.assertEqual(provider.complete(system='s', prompt='p'), 'ok')
        sleep.assert_called_once()
        self.assertGreaterEqual(sleep.call_args.args[0], 9.8)
        self.assertLessEqual(sleep.call_args.args[0], 9.8 * 1.5)
