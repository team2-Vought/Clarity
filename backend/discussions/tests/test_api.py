from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from discussions import serializers
from discussions.models import Discussion, Message
from discussions.services import engine, runner, usage

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
            'discussions.services.engine.calls.get_provider',
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
        # клієнт входить заголовком (auth()), а не cookie, що лишився від входу
        self.client.cookies.clear()
        return response.cookies['clarity_auth'].value

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
                'rounds': 2,
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
            (
                {
                    'question': 'достатньо довге запитання?',
                    'personas': ['logician', 'skeptic'],
                    'rounds': 1,
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
                'rounds': 2,
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

    def test_persona_style_and_temperature_ignored(self):
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
        self.assertNotIn('style', response.data['personas'][0])
        self.assertNotIn('temperature', response.data['personas'][0])

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
            ['Юрист', 'Креативник'],
        )
        self.assertIn('thesis', step.data['messages'][0])
        self.assertEqual(step.data['discussion']['phase'], 'debate')

        second = self.client.post(f'/api/discussions/{response.data["id"]}/advance/')
        self.assertEqual(second.status_code, 200)
        self.assertEqual(len(second.data['messages']), 1)
        self.assertEqual(second.data['message']['persona_name'], 'Юрист')
        self.assertEqual(second.data['message']['reply_to'], 'Креативник')

    def test_unnamed_participants_are_named_after_their_role(self):
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
            ['Логік', 'Оля', 'Креативник'],
        )
        step = self.client.post(f'/api/discussions/{response.data["id"]}/advance/')
        names = [m['persona_name'] for m in step.data['messages']]
        self.assertEqual(names, ['Логік', 'Оля', 'Креативник'])

    def test_role_names_follow_the_interface_language(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {'question': 'Should I launch my own product?', 'personas': ['logician', 'emotional']},
            format='json',
            HTTP_ACCEPT_LANGUAGE='en',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual([p['name'] for p in response.data['personas']], ['Logician', 'Empath'])

    def test_name_clashing_with_default_is_rejected(self):
        self.auth()
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                # безіменний скептик зветься «Скептик» — те саме ім'я в логіка заборонене
                'personas': [{'slug': 'logician', 'name': 'Скептик'}, {'slug': 'skeptic'}],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_persona_out_of_range_temperature_ignored(self):
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
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('temperature', response.data['personas'][0])

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

    @override_settings(DISCUSSION_DAILY_ADVANCE_LIMIT=3)
    def test_deleting_discussion_does_not_restore_reply_limit(self):
        self.auth()
        payload = {
            'question': 'Чи варто запускати власний продукт?',
            'personas': ['logician', 'skeptic'],
        }
        first = self.client.post('/api/discussions/', payload, format='json')
        step = self.client.post(f'/api/discussions/{first.data["id"]}/advance/')
        self.assertEqual(step.status_code, 200)
        # + 1 — перевірка контексту модератором перед вступом
        self.assertEqual(usage.today(self.user).replies, len(step.data['messages']) + 1)
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


    def _make(self, question, **extra):
        return Discussion.objects.create(
            user=self.user, question=question, personas=[{'slug': 'logician'}], **extra
        )

    def test_history_is_paginated(self):
        self.auth()
        for index in range(5):
            self._make(f'Питання номер {index} про переїзд')
        first = self.client.get('/api/discussions/?limit=2')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data['total'], 5)
        self.assertEqual(len(first.data['results']), 2)
        self.assertEqual(first.data['next_offset'], 2)
        last = self.client.get('/api/discussions/?limit=2&offset=4')
        self.assertEqual(len(last.data['results']), 1)
        self.assertIsNone(last.data['next_offset'])

    def test_history_filters_by_status(self):
        self.auth()
        self._make('Завершене питання про роботу', status=Discussion.Status.DONE)
        self._make('Питання з помилкою про роботу', status=Discussion.Status.FAILED)
        response = self.client.get('/api/discussions/?status=failed')
        self.assertEqual([item['status'] for item in response.data['results']], ['failed'])
        ignored = self.client.get('/api/discussions/?status=bogus')
        self.assertEqual(ignored.data['total'], 2)

    def test_history_search_ignores_cyrillic_case(self):
        self.auth()
        self._make('Чи варто переїжджати до Львова?')
        self._make(
            'Яку мову програмування вчити?',
            final_summary={'decision': 'Почати з Python'},
        )
        self._make('Що подарувати мамі?')
        by_question = self.client.get('/api/discussions/', {'q': 'ЛЬВОВА'})
        self.assertEqual(
            [item['title'] for item in by_question.data['results']],
            ['Чи варто переїжджати до Львова?'],
        )
        by_decision = self.client.get('/api/discussions/', {'q': 'python'})
        self.assertEqual(by_decision.data['total'], 1)

    def test_title_is_first_sentence_of_question(self):
        self.auth()
        discussion = self._make('Чи брати іпотеку? Мені 30, зарплата стабільна.\nДеталі нижче')
        listed = self.client.get('/api/discussions/')
        self.assertEqual(listed.data['results'][0]['title'], 'Чи брати іпотеку?')
        detail = self.client.get(f'/api/discussions/{discussion.id}/')
        self.assertEqual(detail.data['title'], 'Чи брати іпотеку?')
        long = serializers.discussion_title('слово ' * 40)
        self.assertLessEqual(len(long), 91)
        self.assertTrue(long.endswith('…'))

    def test_replies_record_the_model(self):
        self.auth()
        created = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': ['logician', 'skeptic'],
            },
            format='json',
        )
        step = self.client.post(f'/api/discussions/{created.data["id"]}/advance/')
        self.assertEqual(step.status_code, 200)
        self.assertTrue(all(message['model_id'] for message in step.data['messages']))


    def _created(self):
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': ['logician', 'skeptic'],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        # стиль із часів, коли його ще можна було задати, — публічно не видно
        discussion = Discussion.objects.get(pk=response.data['id'])
        discussion.personas[0]['style'] = 'таємний стиль'
        discussion.save(update_fields=['personas'])
        return response.data['id']

    def test_share_link_gives_read_only_access_without_login(self):
        self.auth()
        discussion_id = self._created()
        shared = self.client.post(f'/api/discussions/{discussion_id}/share/')
        self.assertEqual(shared.status_code, 200)
        token = shared.data['share_token']
        # повторне вмикання не змінює посилання
        again = self.client.post(f'/api/discussions/{discussion_id}/share/')
        self.assertEqual(again.data['share_token'], token)

        anonymous = APIClient()
        public = anonymous.get(f'/api/shared/{token}/')
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.data['title'], 'Чи варто запускати власний продукт?')
        self.assertEqual(public.data['messages'][0]['persona_name'], serializers.SHARED_AUTHOR)
        self.assertNotIn('Тест', str(public.data))
        self.assertNotIn('таємний стиль', str(public.data))
        self.assertNotIn('share_token', public.data)

    def test_revoked_share_link_stops_working(self):
        self.auth()
        discussion_id = self._created()
        token = self.client.post(f'/api/discussions/{discussion_id}/share/').data['share_token']
        revoked = self.client.delete(f'/api/discussions/{discussion_id}/share/')
        self.assertEqual(revoked.status_code, 204)
        self.assertEqual(APIClient().get(f'/api/shared/{token}/').status_code, 404)
        fresh = self.client.post(f'/api/discussions/{discussion_id}/share/').data['share_token']
        self.assertNotEqual(fresh, token)

    def test_cannot_share_someone_elses_discussion(self):
        self.auth()
        discussion_id = self._created()
        other = User.objects.create_user(email='other-share@test.com', name='Інший', password='pass123!A')
        Discussion.objects.filter(pk=discussion_id).update(user=other)
        self.assertEqual(self.client.post(f'/api/discussions/{discussion_id}/share/').status_code, 404)

    def test_pin_and_archive(self):
        self.auth()
        older = self._make('Старіше питання про переїзд')
        newer = self._make('Новіше питання про переїзд')
        self.client.patch(f'/api/discussions/{older.id}/', {'pinned': True}, format='json')
        listed = self.client.get('/api/discussions/')
        self.assertEqual([item['id'] for item in listed.data['results']], [str(older.id), str(newer.id)])
        self.assertTrue(listed.data['results'][0]['pinned'])

        self.client.patch(f'/api/discussions/{newer.id}/', {'archived': True}, format='json')
        active = self.client.get('/api/discussions/')
        self.assertEqual([item['id'] for item in active.data['results']], [str(older.id)])
        archive = self.client.get('/api/discussions/?archived=1')
        self.assertEqual([item['id'] for item in archive.data['results']], [str(newer.id)])

    def test_pin_is_allowed_while_running(self):
        self.auth()
        discussion = self._make('Питання, яке зараз обговорюють')
        with mock.patch('discussions.views.runner.is_active', return_value=True):
            pinned = self.client.patch(f'/api/discussions/{discussion.id}/', {'pinned': True}, format='json')
            self.assertEqual(pinned.status_code, 200)
            blocked = self.client.patch(
                f'/api/discussions/{discussion.id}/', {'moderator_model': ''}, format='json'
            )
            self.assertEqual(blocked.status_code, 409)

    def test_model_can_change_while_failed_step_waits_for_retry(self):
        # крок упав, раннер ще живий (чекає автоповтору) — модель уже можна змінити
        self.auth()
        discussion = self._make('Питання, на якому впала модель')
        Discussion.objects.filter(pk=discussion.pk).update(
            status=Discussion.Status.FAILED, error_code='quota', error_public='Квота'
        )
        with mock.patch('discussions.views.runner.is_active', return_value=True):
            changed = self.client.patch(
                f'/api/discussions/{discussion.id}/', {'moderator_model': ''}, format='json'
            )
        self.assertEqual(changed.status_code, 200)
        discussion.refresh_from_db()
        self.assertEqual(discussion.error_code, '')

    def test_teams_are_saved_updated_and_deleted(self):
        self.auth()
        payload = {'name': '  Моя   команда ', 'personas': [{'slug': 'logician', 'name': 'Аналітик'}, 'skeptic']}
        created = self.client.post('/api/teams/', payload, format='json')
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['name'], 'Моя команда')
        self.assertEqual([p['name'] for p in created.data['personas']], ['Аналітик', 'Скептик'])

        payload['personas'] = ['creative', 'pragmatist', 'emotional']
        updated = self.client.post('/api/teams/', payload, format='json')
        self.assertEqual(updated.status_code, 200)
        listed = self.client.get('/api/teams/')
        self.assertEqual(len(listed.data['results']), 1)
        self.assertEqual(len(listed.data['results'][0]['personas']), 3)

        invalid = self.client.post('/api/teams/', {'name': 'Одна', 'personas': ['logician']}, format='json')
        self.assertEqual(invalid.status_code, 400)

        deleted = self.client.delete(f'/api/teams/{created.data["id"]}/')
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get('/api/teams/').data['results'], [])

    def test_teams_are_private(self):
        self.auth()
        created = self.client.post(
            '/api/teams/', {'name': 'Секретна', 'personas': ['logician', 'skeptic']}, format='json'
        )
        other = User.objects.create_user(email='other-team@test.com', name='Інший', password='pass123!A')
        client = APIClient()
        client.force_authenticate(other)
        self.assertEqual(client.get('/api/teams/').data['results'], [])
        self.assertEqual(client.delete(f'/api/teams/{created.data["id"]}/').status_code, 404)


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


class ClarifyApiTests(TestCase):
    """Дискусія стартує одразу, а модератор першим кроком перевіряє контекст."""

    setUp = DiscussionApiTests.setUp
    login = DiscussionApiTests.login
    auth = DiscussionApiTests.auth

    PAYLOAD = {
        'question': 'Чи варто купувати авто зараз?',
        'personas': ['logician', 'skeptic'],
    }

    def create(self):
        self.auth()
        response = self.client.post('/api/discussions/', self.PAYLOAD, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['phase'], 'clarify')
        return Discussion.objects.get(pk=response.data['id'])

    def test_enough_context_goes_straight_to_opening(self):
        discussion = self.create()
        created = engine.advance(discussion)
        self.assertEqual(len(created), 2)
        self.assertIn('"ready"', self.provider.calls[0]['prompt'])
        discussion.refresh_from_db()
        self.assertEqual(discussion.phase, Discussion.Phase.DEBATE)
        self.assertEqual(discussion.clarify_questions, [])

    def test_questions_pause_discussion_until_answered(self):
        self.provider.clarify_questions = [
            {'question': 'Який у вас **бюджет**?', 'options': ['*До 10 000 $*', '10–20 тис. $', '10–20 тис. $']},
            {'question': 'Питання без варіантів', 'options': ['лише один']},
        ]
        discussion = self.create()
        runner.run(discussion.pk)
        discussion.refresh_from_db()
        self.assertEqual(discussion.phase, Discussion.Phase.CLARIFY)
        self.assertEqual(
            discussion.clarify_questions,
            [
                {'id': 'q1', 'question': 'Який у вас бюджет?', 'why': '', 'options': ['До 10 000 $', '10–20 тис. $']},
                # один варіант — не вибір: питання стає відкритим
                {'id': 'q2', 'question': 'Питання без варіантів', 'why': '', 'options': []},
            ],
        )
        self.assertFalse(discussion.messages.filter(role=Message.Role.AI).exists())
        self.assertEqual(len(self.provider.calls), 1)
        # повторний запуск не питає модератора вдруге
        runner.run(discussion.pk)
        self.assertEqual(len(self.provider.calls), 1)
        self.assertEqual(engine.describe_step(discussion), [])
        # потік раннера ще завершується, але дискусія вже чекає на людину
        with mock.patch('discussions.services.runner.is_active', return_value=True):
            self.assertFalse(runner.is_working(discussion))

        note = self.client.post(
            f'/api/discussions/{discussion.id}/messages/', {'content': 'Ще деталь'}, format='json'
        )
        self.assertEqual(note.status_code, 400)

        with mock.patch('discussions.views.runner.start') as start:
            response = self.client.post(
                f'/api/discussions/{discussion.id}/clarify/',
                {
                    'answers': [
                        {'question': 'Який у вас бюджет?', 'answer': '  До 10 000 $ '},
                        {'question': 'Пропущене питання', 'answer': ''},
                    ]
                },
                format='json',
            )
        self.assertEqual(response.status_code, 200)
        start.assert_called_once()
        self.assertEqual(response.data['phase'], 'opening')
        self.assertEqual(response.data['clarify_questions'], [])
        self.assertEqual(
            response.data['clarifications'],
            [{'question': 'Який у вас бюджет?', 'answer': 'До 10 000 $'}],
        )

        discussion.refresh_from_db()
        engine.advance(discussion)
        prompt = self.provider.calls[-1]['prompt']
        self.assertIn('Уточнення від користувача', prompt)
        self.assertIn('- Який у вас бюджет? — До 10 000 $', prompt)
        self.assertNotIn('Пропущене питання', prompt)

    def test_answers_rejected_when_not_awaiting(self):
        discussion = self.create()
        response = self.client.post(
            f'/api/discussions/{discussion.id}/clarify/', {'answers': []}, format='json'
        )
        self.assertEqual(response.status_code, 409)

    def test_moderator_failure_does_not_block_start(self):
        discussion = self.create()
        with mock.patch(
            'discussions.services.engine.user_input.clarify',
            side_effect=engine.EngineError('збій', code='provider_error'),
        ):
            created = engine.advance(discussion)
        self.assertEqual(len(created), 2)
        discussion.refresh_from_db()
        self.assertEqual(discussion.status, Discussion.Status.IN_PROGRESS)
