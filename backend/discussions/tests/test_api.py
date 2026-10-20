from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from discussions.models import Discussion

User = get_user_model()


@override_settings(LLM_PROVIDER='mock')
class DiscussionApiTests(TestCase):
    def setUp(self):
        # DRF кешує THROTTLE_RATES при імпорті, тому вимикаємо throttle патчем
        patcher = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request',
            return_value=True,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

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
        self.assertEqual(step.data['message']['persona_name'], 'Юрист')

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
