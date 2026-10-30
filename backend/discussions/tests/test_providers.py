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


class QuotaTests(SimpleTestCase):
    @override_settings(LLM_GEMINI_API_KEY='g-test', LLM_MAX_RETRIES=2)
    def test_exhausted_quota_is_not_retried(self):
        provider = get_provider('gemini:gemini-3.8-flash')
        response = fake_response(
            {'error': {'code': 429, 'message': 'You exceeded your current quota'}},
            status_code=429,
        )
        response.text = '{"error": {"message": "You exceeded your current quota"}}'
        response.headers = {}
        with mock.patch(
            'discussions.services.providers.httpx.post', return_value=response
        ) as post, mock.patch('discussions.services.providers.time.sleep') as sleep:
            with self.assertRaises(ProviderError) as ctx:
                provider.complete(system='s', prompt='p')
        self.assertEqual(post.call_count, 1)
        sleep.assert_not_called()
        self.assertTrue(ctx.exception.quota)
        self.assertTrue(ctx.exception.config)

    @override_settings(LLM_GROQ_API_KEY='gsk-test', LLM_MAX_RETRIES=1)
    def test_per_minute_rate_limit_is_retried(self):
        provider = get_provider('groq:openai/gpt-oss-120b')
        limited = fake_response({}, status_code=429)
        limited.text = (
            '{"error":{"message":"Rate limit reached ... on tokens per minute (TPM): '
            'Please try again in 1.5s. Upgrade at https://console.groq.com/settings/billing"}}'
        )
        limited.headers = {'Retry-After': '1'}
        ok = fake_response({'choices': [{'message': {'content': 'Готово'}}]})
        with mock.patch(
            'discussions.services.providers.httpx.post', side_effect=[limited, ok]
        ), mock.patch('discussions.services.providers.time.sleep'):
            self.assertEqual(provider.complete(system='s', prompt='p'), 'Готово')


class FakeStream:
    def __init__(self, lines, status_code=200, text=''):
        self.lines = lines
        self.status_code = status_code
        self.text = text

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.text

    def iter_lines(self):
        yield from self.lines


class StreamingProviderTests(SimpleTestCase):
    @override_settings(LLM_OPENAI_API_KEY='sk-test')
    def test_openai_compatible_stream_reports_growing_text(self):
        provider = get_provider('openai:gpt-6-luna')
        lines = [
            'data: {"choices":[{"delta":{"role":"assistant"}}]}',
            '',
            'data: {"choices":[{"delta":{"content":"Пер"}}]}',
            'data: {"choices":[{"delta":{"content":"ший"}}]}',
            'data: {"choices":[]}',
            'data: [DONE]',
        ]
        seen = []
        with mock.patch(
            'discussions.services.providers.httpx.stream', return_value=FakeStream(lines)
        ) as stream:
            result = provider.complete(system='s', prompt='p', on_text=seen.append)
        self.assertEqual(result, 'Перший')
        self.assertEqual(seen, ['Пер', 'Перший'])
        self.assertTrue(stream.call_args.kwargs['json']['stream'])

    @override_settings(LLM_ANTHROPIC_API_KEY='sk-ant-test')
    def test_anthropic_stream_reports_text_deltas(self):
        provider = get_provider('anthropic:claude-sonnet-5-5')
        lines = [
            'event: message_start',
            'data: {"type":"message_start","message":{}}',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"…"}}',
            'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"При"}}',
            'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"віт"}}',
            'data: {"type":"message_stop"}',
        ]
        seen = []
        with mock.patch(
            'discussions.services.providers.httpx.stream', return_value=FakeStream(lines)
        ):
            result = provider.complete(system='s', prompt='p', on_text=seen.append)
        self.assertEqual(result, 'Привіт')
        self.assertEqual(seen, ['При', 'Привіт'])

    @override_settings(LLM_OPENAI_API_KEY='sk-test', LLM_RETRY_DELAY_SECONDS=0)
    def test_failed_stream_falls_back_to_a_plain_request(self):
        provider = get_provider('openai:gpt-6-luna')
        seen = []
        with (
            mock.patch(
                'discussions.services.providers.httpx.stream',
                return_value=FakeStream([], status_code=503, text='overloaded'),
            ),
            mock.patch(
                'discussions.services.providers.httpx.post',
                return_value=fake_response({'choices': [{'message': {'content': 'Готово'}}]}),
            ) as post,
        ):
            result = provider.complete(system='s', prompt='p', on_text=seen.append)
        self.assertEqual(result, 'Готово')
        self.assertEqual(seen, [''])
        self.assertNotIn('stream', post.call_args.kwargs['json'])

    @override_settings(LLM_OPENAI_API_KEY='sk-test')
    def test_bad_key_is_not_retried_without_stream(self):
        provider = get_provider('openai:gpt-6-luna')
        with (
            mock.patch(
                'discussions.services.providers.httpx.stream',
                return_value=FakeStream([], status_code=401, text='bad key'),
            ),
            mock.patch('discussions.services.providers.httpx.post') as post,
        ):
            with self.assertRaises(ProviderError) as ctx:
                provider.complete(system='s', prompt='p', on_text=lambda text: None)
        self.assertTrue(ctx.exception.config)
        post.assert_not_called()

    @override_settings(LLM_OPENAI_API_KEY='sk-test')
    def test_json_mode_never_streams(self):
        provider = get_provider('openai:gpt-6-luna')
        with (
            mock.patch('discussions.services.providers.httpx.stream') as stream,
            mock.patch(
                'discussions.services.providers.httpx.post',
                return_value=fake_response({'choices': [{'message': {'content': '{}'}}]}),
            ),
        ):
            provider.complete(system='s', prompt='p', json_mode=True, on_text=lambda text: None)
        stream.assert_not_called()
