from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from discussions.models import Discussion, Message
from discussions.services import engine, usage

from .fakes import FakeProvider

User = get_user_model()


class DiscussionApiTests(TestCase):
    def setUp(self):
        # DRF кешує THROTTLE_RATES при імпорті, тому вимикаємо throttle патчем
        patcher = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request',
            return_value=True,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

        self.provider = FakeProvider()
        provider_patcher = mock.patch(
            'discussions.services.engine.get_provider',
            side_effect=lambda model_id: self.provider,
        )
        provider_patcher.start()
        self.addCleanup(provider_patcher.stop)

        self.client = APIClient()
        self.user = User.objects.create_user(
            email='api@test.com', name='Тест', password='pass123!A'
        )
        self.token = self.login()

    def login(self):
        response = self.client.post(
            '/api/auth/login/',
            {'email': 'api@test.com', 'password': 'pass123!A'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        return response.data['token']

    def auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token}')

    def test_personas_requires_auth(self):
        response = self.client.get('/api/personas/')
        self.assertEqual(response.status_code, 401)

    def test_personas_list(self):
        self.auth()
        response = self.client.get('/api/personas/')
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.data['personas']), 2)
        self.assertEqual(response.data['devil']['slug'], 'devil')
        self.assertNotIn(
            'devil',
            [p['slug'] for p in response.data['personas']],
        )
        mode_values = [m['value'] for m in response.data['modes']]
        self.assertEqual(mode_values, ['yes_no', 'choose_one', 'open'])

    def test_models_catalog(self):
        self.auth()
        response = self.client.get('/api/models/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['models'])
        model_ids = {item['id'] for item in response.data['models']}
        self.assertIn('openai:gpt-6-luna', model_ids)
        self.assertIn('groq:openai/gpt-oss-120b', model_ids)
        self.assertNotIn('mock', model_ids)
        for item in response.data['models']:
            self.assertNotIn('mock', item['provider'].lower())

    def test_persona_model_and_traits_accepted(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': [
                    {
                        'slug': 'logician',
                        'model': 'groq:openai/gpt-oss-120b',
                        'traits': ['Стратег', 'Перфекціоніст'],
                    },
                    {'slug': 'creative', 'model': 'groq:openai/gpt-oss-120b'},
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.data['personas'][0]['model'],
            'groq:openai/gpt-oss-120b',
        )
        self.assertEqual(
            response.data['personas'][0]['traits'],
            ['Стратег', 'Перфекціоніст'],
        )

    def test_unknown_model_rejected(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': [
                    {'slug': 'logician', 'model': 'stub:fake-model'},
                    {'slug': 'creative', 'model': 'openai:gpt-6-luna'},
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_create_discussion_and_complete(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто купувати авто зараз?',
                'personas': ['logician', 'skeptic'],
                'rounds': 1,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        discussion_id = response.data['id']
        self.assertEqual(response.data['status'], 'new')
        self.assertEqual(len(response.data['messages']), 1)

        for _ in range(30):
            step = self.client.post(f'/api/discussions/{discussion_id}/advance/')
            self.assertEqual(step.status_code, 200)
            if step.data['discussion']['is_finished']:
                break
        else:
            self.fail('дискусія не завершилася')

        detail = self.client.get(f'/api/discussions/{discussion_id}/')
        self.assertEqual(detail.status_code, 200)
        self.assertIsNotNone(detail.data['final_summary'])
        self.assertIn('decision', detail.data['final_summary'])

    def test_create_validation_errors(self):
        self.auth()
        cases = [
            ({'question': 'коротке', 'personas': ['logician', 'skeptic']}, 400),
            ({'question': 'достатньо довге запитання?', 'personas': ['logician']}, 400),
            (
                {
                    'question': 'достатньо довге запитання?',
                    'personas': ['logician', 'devil'],
                },
                400,
            ),
            (
                {
                    'question': 'достатньо довге запитання?',
                    'personas': ['logician', 'logician'],
                },
                400,
            ),
            (
                {
                    'question': 'достатньо довге запитання?',
                    'personas': ['logician', 'skeptic'],
                    'rounds': 99,
                },
                400,
            ),
        ]
        for payload, expected in cases:
            response = self.client.post('/api/discussions/', payload, format='json')
            self.assertEqual(response.status_code, expected, payload)

    def test_mode_validation(self):
        self.auth()
        base = {
            'question': 'Чи варто переїжати в інше місто?',
            'personas': ['logician', 'skeptic'],
        }

        response = self.client.post(
            '/api/discussions/',
            {**base, 'mode': 'choose_one'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

        response = self.client.post(
            '/api/discussions/',
            {**base, 'mode': 'choose_one', 'options': ['Так', 'Ні', 'Незабаром']},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['mode'], 'choose_one')
        self.assertEqual(response.data['options'], ['Так', 'Ні', 'Незабаром'])

        response = self.client.post(
            '/api/discussions/',
            {**base, 'mode': 'open', 'options': ['зайвий']},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

        response = self.client.post(
            '/api/discussions/',
            {**base, 'mode': 'unknown'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_mode_yes_no_full_flow(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто погоджуватися на цю пропозицію?',
                'mode': 'yes_no',
                'personas': ['logician', 'skeptic'],
                'rounds': 1,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        discussion_id = response.data['id']

        for _ in range(30):
            step = self.client.post(f'/api/discussions/{discussion_id}/advance/')
            self.assertEqual(step.status_code, 200)
            if step.data['discussion']['is_finished']:
                break
        else:
            self.fail('дискусія не завершилася')

        detail = self.client.get(f'/api/discussions/{discussion_id}/')
        self.assertEqual(detail.data['final_summary'].get('answer'), 'так')
        self.assertIn('confirmed', detail.data['final_summary'])

    def test_persona_style_override_accepted(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': [
                    {'slug': 'logician', 'style': 'Ти — воєнний стратег.', 'temperature': 0.3},
                    {'slug': 'creative'},
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['personas'][0]['style'], 'Ти — воєнний стратег.')
        self.assertEqual(response.data['personas'][0]['temperature'], 0.3)

    def test_persona_name_override_accepted(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': [
                    {'slug': 'logician', 'name': 'Юрист'},
                    {'slug': 'creative'},
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['personas'][0]['name'], 'Юрист')

        step = self.client.post(f'/api/discussions/{response.data["id"]}/advance/')
        self.assertEqual(step.status_code, 200)
        # вступ паралельний: один крок повертає репліки всіх учасників
        self.assertEqual(
            [m['persona_name'] for m in step.data['messages']],
            ['Юрист', 'Учасник 2'],
        )
        self.assertIn('thesis', step.data['messages'][0])
        self.assertEqual(step.data['discussion']['phase'], 'debate')

        second = self.client.post(f'/api/discussions/{response.data["id"]}/advance/')
        self.assertEqual(second.status_code, 200)
        self.assertEqual(len(second.data['messages']), 1)
        self.assertEqual(second.data['message']['persona_name'], 'Юрист')
        self.assertEqual(second.data['message']['reply_to'], 'Учасник 2')

    def test_unnamed_participants_get_numbered_names(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': [
                    {'slug': 'logician'},
                    {'slug': 'skeptic', 'name': 'Оля'},
                    'creative',
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            [p['name'] for p in response.data['personas']],
            ['Учасник 1', 'Оля', 'Учасник 3'],
        )
        step = self.client.post(f'/api/discussions/{response.data["id"]}/advance/')
        names = [m['persona_name'] for m in step.data['messages']]
        self.assertEqual(names, ['Учасник 1', 'Оля', 'Учасник 3'])
        self.assertNotIn('Логік', ' '.join(call['prompt'] for call in self.provider.calls))

    def test_name_clashing_with_default_is_rejected(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': [{'slug': 'logician', 'name': 'Учасник 2'}, {'slug': 'skeptic'}],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_persona_temperature_range(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': [
                    {'slug': 'logician', 'temperature': 2},
                    {'slug': 'creative'},
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_advance_foreign_discussion_forbidden(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто змінювати місто проживання?',
                'personas': ['logician', 'skeptic'],
            },
            format='json',
        )
        discussion_id = response.data['id']

        other = User.objects.create_user(
            email='other@test.com', name='Інший', password='pass123!A'
        )
        Discussion.objects.filter(id=discussion_id).update(user=other)

        detail = self.client.get(f'/api/discussions/{discussion_id}/')
        self.assertEqual(detail.status_code, 404)

    def test_list_own_discussions(self):
        self.auth()
        self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто починати власний проєкт?',
                'personas': ['creative', 'pragmatist'],
            },
            format='json',
        )
        response = self.client.get('/api/discussions/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 1)

    def test_list_preview_prefers_decision_then_last_reply(self):
        self.auth()
        base = {'user': self.user, 'personas': ['logician', 'skeptic']}
        decided = Discussion.objects.create(
            question='Купити чи орендувати?',
            final_summary={'decision': '**Орендувати** ще   два роки.'},
            **base,
        )
        running = Discussion.objects.create(question='Чи вчити Rust?', **base)
        message = {
            'phase': Discussion.Phase.OPENING,
            'persona_slug': 'logician',
            'persona_name': 'Логік',
            'avatar': 'L',
        }
        Message.objects.create(
            discussion=running, seq=1, role=Message.Role.AI, content='Перша думка', **message
        )
        Message.objects.create(
            discussion=running, seq=2, role=Message.Role.AI, content='Остання думка', **message
        )
        Message.objects.create(
            discussion=running, seq=3, role=Message.Role.USER, content='Питання від мене', **message
        )
        empty = Discussion.objects.create(question='Нова дискусія без реплік', **base)

        response = self.client.get('/api/discussions/')
        previews = {item['id']: item['preview'] for item in response.data['results']}
        self.assertEqual(previews[str(decided.id)], 'Орендувати ще два роки.')
        self.assertEqual(previews[str(running.id)], 'Остання думка')
        self.assertEqual(previews[str(empty.id)], '')

    def test_question_keeps_line_breaks(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Перший рядок питання?\nДругий рядок питання.',
                'personas': ['logician', 'skeptic'],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.data['question'],
            'Перший рядок питання?\nДругий рядок питання.',
        )

    def test_duplicate_effective_names_rejected(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': [
                    {'slug': 'logician', 'name': 'Оля'},
                    {'slug': 'skeptic', 'name': 'оля'},
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('personas', response.data)

    @override_settings(LLM_OPENAI_API_KEY='')
    def test_unavailable_model_rejected(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': [
                    {'slug': 'logician', 'model': 'openai:gpt-6-luna'},
                    {'slug': 'skeptic'},
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('personas', response.data)

    @override_settings(DISCUSSION_DAILY_LIMIT=1)
    def test_daily_discussion_limit(self):
        self.auth()
        payload = {
            'question': 'Чи варто запускати власний продукт?',
            'personas': ['logician', 'skeptic'],
        }
        self.assertEqual(
            self.client.post('/api/discussions/', payload, format='json').status_code,
            201,
        )
        limited = self.client.post('/api/discussions/', payload, format='json')
        self.assertEqual(limited.status_code, 429)
        self.assertIn('Retry-After', limited.headers)

    @override_settings(DISCUSSION_DAILY_ADVANCE_LIMIT=1)
    def test_daily_advance_limit(self):
        self.auth()
        created = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': ['logician', 'skeptic'],
            },
            format='json',
        )
        discussion = Discussion.objects.get(pk=created.data['id'])
        usage.record(self.user.pk, replies=1)
        limited = self.client.post(f'/api/discussions/{discussion.id}/advance/')
        self.assertEqual(limited.status_code, 429)

    @override_settings(DISCUSSION_DAILY_LIMIT=1)
    def test_deleting_discussion_does_not_restore_creation_limit(self):
        self.auth()
        payload = {
            'question': 'Чи варто запускати власний продукт?',
            'personas': ['logician', 'skeptic'],
        }
        created = self.client.post('/api/discussions/', payload, format='json')
        self.assertEqual(created.status_code, 201)
        self.client.delete(f'/api/discussions/{created.data["id"]}/')

        limited = self.client.post('/api/discussions/', payload, format='json')
        self.assertEqual(limited.status_code, 429)

    @override_settings(DISCUSSION_DAILY_ADVANCE_LIMIT=1)
    def test_deleting_discussion_does_not_restore_reply_limit(self):
        self.auth()
        payload = {
            'question': 'Чи варто запускати власний продукт?',
            'personas': ['logician', 'skeptic'],
        }
        first = self.client.post('/api/discussions/', payload, format='json')
        step = self.client.post(f'/api/discussions/{first.data["id"]}/advance/')
        self.assertEqual(step.status_code, 200)
        self.assertEqual(usage.today(self.user).replies, len(step.data['messages']))
        self.client.delete(f'/api/discussions/{first.data["id"]}/')

        second = self.client.post('/api/discussions/', payload, format='json')
        limited = self.client.post(f'/api/discussions/{second.data["id"]}/advance/')
        self.assertEqual(limited.status_code, 429)

    def test_action_endpoints_do_not_inherit_detail_methods(self):
        self.auth()
        created = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': ['logician', 'skeptic'],
            },
            format='json',
        )
        discussion_id = created.data['id']
        for action in ('advance', 'run', 'stop', 'messages'):
            url = f'/api/discussions/{discussion_id}/{action}/'
            self.assertEqual(self.client.get(url).status_code, 405, action)
            self.assertEqual(self.client.patch(url, {}, format='json').status_code, 405, action)
            self.assertEqual(self.client.delete(url).status_code, 405, action)
        self.assertTrue(Discussion.objects.filter(pk=discussion_id).exists())

    def test_delete_own_discussion(self):
        self.auth()
        created = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': ['logician', 'skeptic'],
            },
            format='json',
        )
        discussion_id = created.data['id']
        deleted = self.client.delete(f'/api/discussions/{discussion_id}/')
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(Discussion.objects.filter(pk=discussion_id).exists())

    def test_busy_advance_returns_conflict(self):
        self.auth()
        created = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': ['logician', 'skeptic'],
            },
            format='json',
        )
        with mock.patch(
            'discussions.views.engine.advance',
            side_effect=engine.EngineBusy('busy'),
        ):
            response = self.client.post(
                f'/api/discussions/{created.data["id"]}/advance/'
            )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.headers['Retry-After'], '2')

    def test_provider_error_is_sanitized(self):
        self.auth()
        created = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': ['logician', 'skeptic'],
            },
            format='json',
        )
        with mock.patch(
            'discussions.views.logger.exception'
        ), mock.patch(
            'discussions.views.engine.advance',
            side_effect=engine.EngineError(
                'raw provider failure',
                detail='secret-api-key leaked',
            ),
        ):
            response = self.client.post(
                f'/api/discussions/{created.data["id"]}/advance/'
            )
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('secret-api-key', response.data['detail'])
        self.assertIn('Спробуйте', response.data['detail'])
    def test_delete_foreign_discussion_forbidden(self):
        self.auth()
        created = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': ['logician', 'skeptic'],
            },
            format='json',
        )
        other = User.objects.create_user(
            email='delete-other@test.com', name='Інший', password='pass123!A'
        )
        Discussion.objects.filter(pk=created.data['id']).update(user=other)
        response = self.client.delete(f'/api/discussions/{created.data["id"]}/')
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Discussion.objects.filter(pk=created.data['id']).exists())


class DiscussionThrottleTests(TestCase):
    """Справжній throttle (без патчу allow_request з DiscussionApiTests)."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        rates = mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {'discussion_create': '1/min'})
        rates.start()
        self.addCleanup(rates.stop)
        self.user = User.objects.create_user(
            email='throttle@test.com', name='Тест', password='pass123!A'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_history_is_not_limited_by_creation_rate(self):
        for _ in range(3):
            self.assertEqual(self.client.get('/api/discussions/').status_code, 200)

    def test_creation_is_still_rate_limited(self):
        payload = {
            'question': 'Чи варто запускати власний продукт?',
            'personas': ['logician', 'skeptic'],
        }
        self.assertEqual(
            self.client.post('/api/discussions/', payload, format='json').status_code, 201
        )
        self.assertEqual(
            self.client.post('/api/discussions/', payload, format='json').status_code, 429
        )
