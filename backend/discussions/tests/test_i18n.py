import re
"""Англійська мова: інтерфейсні тексти API, промпти й підсумки дискусії."""

import contextvars
import threading
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import translation
from rest_framework.test import APIClient

from backend.i18n import current, using
from discussions.models import Discussion, Message
from discussions.services import engine, prompts

from .fakes import FakeProvider

User = get_user_model()


class EnglishApiTests(TestCase):
    def setUp(self):
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

        # LocaleMiddleware лишає мову активною в потоці тестів — повертаємо типову
        self.addCleanup(translation.deactivate)

        self.user = User.objects.create_user(email='en@test.com', name='Test', password='pass123!A')
        self.client = APIClient(HTTP_ACCEPT_LANGUAGE='en')
        self.client.force_authenticate(self.user)

    def test_personas_in_english(self):
        data = self.client.get('/api/personas/').data
        names = {persona['slug']: persona['name'] for persona in data['personas']}
        self.assertEqual(names['logician'], 'Logician')
        self.assertEqual(data['devil']['temperament'], 'Hostile skeptic')
        self.assertIn({'value': 'yes_no', 'label': 'Yes or no'}, data['modes'])

    def test_personas_in_ukrainian_by_default(self):
        client = APIClient()
        client.force_authenticate(self.user)
        names = {persona['slug']: persona['name'] for persona in client.get('/api/personas/').data['personas']}
        self.assertEqual(names['logician'], 'Логік')

    def test_validation_errors_in_english(self):
        response = self.client.post(
            '/api/discussions/', {'question': 'short', 'personas': ['logician', 'skeptic']}, format='json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('at least 10 characters', str(response.data['question']))

    def test_discussion_runs_in_its_language(self):
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Should I buy a car right now?',
                'personas': ['logician', 'skeptic'],
                'mode': 'yes_no',
                'rounds': 2,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['language'], 'en')
        discussion = Discussion.objects.get(pk=response.data['id'])

        # фоновий потік не має мови запиту — крок бере її з дискусії
        for _ in range(30):
            engine.advance(discussion)
            discussion.refresh_from_db()
            if discussion.is_finished:
                break
        else:
            self.fail('the discussion did not finish')

        # інструкції — англійською (мовою інтерфейсу); мову відповіді задає людина
        systems = [call['system'] for call in self.provider.calls]
        self.assertTrue(systems)
        self.assertFalse([system for system in systems if re.search('[а-яіїєґ]', system, re.IGNORECASE)])
        final = discussion.messages.filter(role=Message.Role.MODERATOR).order_by('-seq').first()
        self.assertIn('### Final solution', final.content)
        self.assertNotIn('Відповідь', final.content)


class EnglishPromptTests(SimpleTestCase):
    def test_language_reaches_background_threads(self):
        # так рушій запускає рядок статусу й паралельні виклики моделей
        seen = []
        with using('en'):
            context = contextvars.copy_context()
            thread = threading.Thread(target=context.run, args=(lambda: seen.append(current()),))
            thread.start()
            thread.join()
            seen.append(prompts.status_system())
        self.assertEqual(seen[0], 'en')
        self.assertEqual(seen[1], prompts.STATUS_SYSTEM_EN)
        self.assertEqual(current(), 'uk')

    def test_service_lines_in_english_are_parsed(self):
        raw = 'We should wait.\n\nTHESIS: Waiting is cheaper\nSTANCE: dispute\nSEARCH: car prices 2026'
        parsed = engine.parse_reply(raw, 'open', [])
        self.assertEqual(parsed['content'], 'We should wait.')
        self.assertEqual(parsed['thesis'], 'Waiting is cheaper')
        self.assertEqual(parsed['stance'], engine.STANCE_DISPUTE)
        self.assertEqual(parsed['search_query'], 'car prices 2026')

    def test_yes_no_answer_is_stored_as_token(self):
        parsed = engine.parse_reply('Text\nSTANCE: Yes', 'yes_no', [])
        self.assertEqual(parsed['stance'], 'так')

    def test_ai_writes_in_the_users_language_not_the_interface_one(self):
        # мова інтерфейсу задає мову інструкцій, але не мову відповіді
        for language, rule in (('uk', prompts.LANGUAGE_RULE), ('en', prompts.LANGUAGE_RULE_EN)):
            with using(language):
                systems = [
                    prompts.persona_system({'name': 'Logician', 'traits': []}),
                    prompts.moderator_system(),
                    prompts.devil_system(),
                ]
                for system in systems:
                    self.assertIn(rule, system)
                    self.assertNotIn('Відповідай українською', system)
                    self.assertNotIn('Reply in English', system)
                self.assertNotIn('Відповідай українською', prompts.clarify_system())
                self.assertNotIn('Reply in English', prompts.clarify_system())
        with using('uk'):
            prompt = prompts.opening_prompt(
                'Should I move to Berlin for a new job?',
                {'name': 'Логік', 'slug': 'logician', 'traits': []},
                [{'name': 'Логік', 'slug': 'logician'}],
            )
            self.assertIn('Мова відповіді: та сама, якою людина написала питання вище.', prompt)

    def test_english_prompts(self):
        with using('en'):
            system = prompts.persona_system({'name': 'Logician', 'traits': ['Rebel']})
            self.assertIn(prompts.SAFETY_RULE_EN, system)
            self.assertIn('Rebel against ideas, not people', system)
            self.assertIn('Write in the language the person writes in', prompts.moderator_system())
            block = prompts.service_lines_block('yes_no', [], can_search=True)
            self.assertIn('THESIS:', block)
            self.assertIn('STANCE: yes or no', block)
            self.assertIn('SEARCH:', block)
        self.assertIn('ТЕЗА:', prompts.service_lines_block('yes_no', []))
