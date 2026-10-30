from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from backend.i18n import using
from discussions.models import Discussion
from discussions.services import prompts

from .fakes import FakeProvider

User = get_user_model()

ABOUT = {
    'location': 'Львів, Україна',
    'age': '25_34',
    'family': 'Одружений, донька 3 роки',
    'occupation': 'Бекенд-розробник',
    'finances': 'savings',
    'finances_note': 'іпотека 9 000 грн на місяць',
    'values': ['family', 'stability'],
    'risk': 'cautious',
    'notes': 'Не хочу переїжджати за кордон',
}


class AboutApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(email='about@test.com', name='Тест', password='pass123!A')
        self.client.force_authenticate(self.user)

    def test_empty_profile_is_on_by_default(self):
        about = self.client.get('/api/auth/me/').data['about']
        self.assertTrue(about['enabled'])
        self.assertEqual(about['values'], [])
        self.assertEqual(about['age'], '')

    def test_profile_is_saved_and_changed_partially(self):
        response = self.client.patch('/api/auth/me/', {'about': ABOUT}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['about']['risk'], 'cautious')

        response = self.client.patch('/api/auth/me/', {'about': {'risk': 'bold'}}, format='json')
        about = response.data['about']
        self.assertEqual(about['risk'], 'bold')
        self.assertEqual(about['location'], 'Львів, Україна')
        self.user.refresh_from_db()
        self.assertEqual(self.user.name, 'Тест')

    def test_text_is_tidied(self):
        response = self.client.patch(
            '/api/auth/me/', {'about': {'family': '  двоє   дітей \n\n\n мама поруч '}}, format='json'
        )
        self.assertEqual(response.data['about']['family'], 'двоє дітей\nмама поруч')

    def test_unknown_choices_and_too_many_values_are_rejected(self):
        for bad in (
            {'age': '30'},
            {'risk': 'yolo'},
            {'values': ['family', 'fame']},
            {'values': ['family', 'stability', 'freedom', 'career', 'money', 'health']},
            {'notes': 'x' * 501},
        ):
            response = self.client.patch('/api/auth/me/', {'about': bad}, format='json')
            self.assertEqual(response.status_code, 400, bad)
            self.assertIn('about', response.data)


@override_settings(DISCUSSION_RUNNER_SYNC=True)
class DiscussionProfileTests(TestCase):
    def setUp(self):
        throttle = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request', return_value=True
        )
        throttle.start()
        self.addCleanup(throttle.stop)
        self.provider = FakeProvider()
        provider = mock.patch(
            'discussions.services.engine.calls.get_provider',
            side_effect=lambda model_id: self.provider,
        )
        provider.start()
        self.addCleanup(provider.stop)
        self.client = APIClient()
        self.user = User.objects.create_user(email='prof@test.com', name='Оксана', password='pass123!A')
        self.client.force_authenticate(self.user)

    def create(self, **extra):
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто брати другу роботу на вечори?',
                'personas': ['logician', 'skeptic'],
                'rounds': 2,
                **extra,
            },
            format='json',
            HTTP_ACCEPT_LANGUAGE='uk',
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_filled_profile_reaches_every_prompt(self):
        self.client.patch('/api/auth/me/', {'about': ABOUT}, format='json')
        created = self.create()
        self.assertTrue(created['profile_used'])
        self.client.post(f'/api/discussions/{created["id"]}/run/')

        prompts_seen = [call['prompt'] for call in self.provider.calls]
        self.assertTrue(prompts_seen)
        for prompt in prompts_seen:
            self.assertIn('<user_profile>', prompt)
        first = prompts_seen[0]
        self.assertIn('Не питай про те, що вже є в профілі', first)
        self.assertIn('Вік: 25–34 роки', first)
        self.assertIn('Що найважливіше: сім’я, стабільність', first)
        self.assertIn('обережне', first)
        self.assertIn('іпотека 9 000 грн на місяць', first)

    def test_profile_can_be_skipped_for_one_discussion(self):
        self.client.patch('/api/auth/me/', {'about': ABOUT}, format='json')
        created = self.create(use_profile=False)
        self.assertFalse(created['profile_used'])
        self.client.post(f'/api/discussions/{created["id"]}/run/')
        self.assertTrue(all('<user_profile>' not in call['prompt'] for call in self.provider.calls))

    def test_disabled_profile_is_not_used_by_default(self):
        self.client.patch('/api/auth/me/', {'about': {**ABOUT, 'enabled': False}}, format='json')
        self.assertFalse(self.create()['profile_used'])

    def test_discussion_keeps_the_profile_it_was_created_with(self):
        self.client.patch('/api/auth/me/', {'about': ABOUT}, format='json')
        created = self.create()
        self.client.patch('/api/auth/me/', {'about': {'location': 'Київ'}}, format='json')
        discussion = Discussion.objects.get(pk=created['id'])
        self.assertEqual(discussion.profile['location'], 'Львів, Україна')
        self.assertNotIn('enabled', discussion.profile)

    def test_shared_link_does_not_reveal_the_profile(self):
        self.client.patch('/api/auth/me/', {'about': ABOUT}, format='json')
        created = self.create()
        token = self.client.post(f'/api/discussions/{created["id"]}/share/').data['share_token']
        shared = APIClient().get(f'/api/shared/{token}/')
        self.assertEqual(shared.status_code, 200)
        self.assertNotIn('Львів', str(shared.data))
        self.assertNotIn('profile', shared.data)


class ProfileBlockTests(TestCase):
    def test_empty_profile_adds_nothing(self):
        self.assertEqual(prompts.profile_block({}), '')
        self.assertEqual(prompts.profile_block(None), '')

    def test_english_labels_for_english_discussions(self):
        with using('en'):
            block = prompts.profile_block({'age': '35_44', 'risk': 'bold', 'values': ['freedom']})
        self.assertIn('Age: 35–44 years old', block)
        self.assertIn('Attitude to risk: bold', block)
        self.assertIn('What matters most: freedom', block)
