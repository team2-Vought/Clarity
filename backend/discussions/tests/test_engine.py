from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from discussions.models import Discussion, Message
from discussions.services import engine

from .fakes import FakeProvider

User = get_user_model()


class EngineTests(TestCase):
    def setUp(self):
        self.provider = FakeProvider()
        self.provider_factory = lambda model_id: self.provider
        self.user = User.objects.create_user(
            email='engine@test.com', name='Тест', password='pass123!A'
        )
        self.discussion = Discussion.objects.create(
            user=self.user,
            question='Чи варто змінювати роботу на стартап?',
            personas=['logician', 'skeptic', 'creative'],
            rounds=2,
        )
        self.discussion.messages.create(
            seq=1,
            phase=Discussion.Phase.OPENING,
            role=Message.Role.USER,
            persona_slug='user',
            persona_name='Тест',
            avatar='🧑',
            content=self.discussion.question,
        )

    def run_to_completion(self):
        created = 0
        while True:
            message = engine.advance(
                self.discussion, provider_factory=self.provider_factory
            )
            self.discussion.refresh_from_db()
            if message is None:
                break
            created += 1
            self.assertLess(created, 50, 'движок не завершується')
        return created

    def test_full_flow_creates_all_phases(self):
        created = self.run_to_completion()

        self.assertEqual(self.discussion.phase, Discussion.Phase.DONE)
        self.assertEqual(self.discussion.status, Discussion.Status.DONE)
        self.assertIsNotNone(self.discussion.best_solution)
        self.assertIsNotNone(self.discussion.devil_review)
        self.assertIsNotNone(self.discussion.final_summary)
        self.assertIsNotNone(self.discussion.finished_at)
        self.assertIn('confirmed', self.discussion.final_summary)

        phases = set(self.discussion.messages.values_list('phase', flat=True))
        self.assertEqual(
            phases,
            {
                Discussion.Phase.OPENING,
                Discussion.Phase.DEBATE,
                Discussion.Phase.SYNTHESIS,
                Discussion.Phase.DEVIL,
                Discussion.Phase.FINAL,
            },
        )
        # user msg + 3 opening + 3*2 debate + synthesis + devil + final
        self.assertEqual(created, 12)
        self.assertEqual(self.discussion.messages.count(), 1 + created)

        synthesis = self.discussion.messages.get(phase=Discussion.Phase.SYNTHESIS)
        final = self.discussion.messages.get(phase=Discussion.Phase.FINAL)
        self.assertIn('\n\n', synthesis.content)
        self.assertIn('\n\n', final.content)

    def test_messages_have_sequential_unique_seq(self):
        self.run_to_completion()
        seqs = list(self.discussion.messages.order_by('seq').values_list('seq', flat=True))
        self.assertEqual(seqs, list(range(1, len(seqs) + 1)))

    def test_devil_message_present(self):
        self.run_to_completion()
        devil = self.discussion.messages.filter(role=Message.Role.DEVIL).first()
        self.assertIsNotNone(devil)
        self.assertTrue(devil.content.strip())

    def test_advance_after_done_returns_none(self):
        self.run_to_completion()
        self.assertIsNone(engine.advance(self.discussion))

    def test_failed_discussion_can_resume(self):
        self.discussion.status = Discussion.Status.FAILED
        self.discussion.save(update_fields=['status'])
        message = engine.advance(
            self.discussion, provider_factory=self.provider_factory
        )
        self.discussion.refresh_from_db()
        self.assertIsNotNone(message)
        self.assertEqual(self.discussion.status, Discussion.Status.IN_PROGRESS)

    def test_persona_overrides_used(self):
        self.discussion.personas = [
            {'slug': 'logician', 'style': 'Ти — космічний аналітик.', 'temperature': 0.2},
            {'slug': 'skeptic'},
            {'slug': 'creative'},
        ]
        self.discussion.save()
        self.run_to_completion()
        opening = self.discussion.messages.filter(phase=Discussion.Phase.OPENING).first()
        self.assertTrue(opening.content.strip())

    def test_persona_models_are_used(self):
        self.discussion.personas = [
            {'slug': 'logician', 'model': 'openai:gpt-6-luna'},
            {'slug': 'skeptic', 'model': 'groq:openai/gpt-oss-120b'},
            {'slug': 'creative', 'model': 'gemini:gemini-3.8-flash'},
        ]
        self.discussion.save()
        used_models = []

        def factory(model_id):
            used_models.append(model_id)
            return self.provider

        for _ in range(3):
            engine.advance(self.discussion, provider_factory=factory)
            self.discussion.refresh_from_db()

        self.assertEqual(
            used_models,
            [
                'openai:gpt-6-luna',
                'groq:openai/gpt-oss-120b',
                'gemini:gemini-3.8-flash',
            ],
        )

    @override_settings(
        LLM_DEFAULT_MODEL='openai:gpt-6-luna',
        LLM_OPENAI_API_KEY='',
        LLM_ANTHROPIC_API_KEY='',
        LLM_GEMINI_API_KEY='',
        LLM_GROQ_API_KEY='gsk-test',
        LLM_CEREBRAS_API_KEY='',
        LLM_DEEPSEEK_API_KEY='',
        LLM_MISTRAL_API_KEY='',
        LLM_OPENROUTER_API_KEY='',
        LLM_OLLAMA_MODELS=[],
        LLM_CUSTOM_BASE_URL='',
        LLM_CUSTOM_MODEL='',
    )
    def test_default_model_uses_available_fallback(self):
        used_models = []

        def factory(model_id):
            used_models.append(model_id)
            return self.provider

        engine.advance(self.discussion, provider_factory=factory)

        self.assertEqual(used_models, ['groq:openai/gpt-oss-120b'])

    def test_prompt_contains_full_persona_context(self):
        self.discussion.personas = [
            {
                'slug': 'logician',
                'name': 'Логік',
                'style': 'Ти — стратег.',
                'traits': ['Перфекціоніст', 'Стратег'],
                'model': 'openai:gpt-6-luna',
            },
            {'slug': 'skeptic', 'model': 'groq:openai/gpt-oss-120b'},
        ]
        self.discussion.save()
        engine.advance(self.discussion, provider_factory=self.provider_factory)

        prompt = self.provider.calls[0]['prompt']
        self.assertIn(self.discussion.question, prompt)
        self.assertIn('Темперамент: Спокійний, раціональний', prompt)
        self.assertIn('Опис: Тримається фактів', prompt)
        self.assertIn('Додатковий стиль від користувача: Ти — стратег.', prompt)
        self.assertIn('Додаткові риси: Перфекціоніст, Стратег', prompt)
        self.assertIn('Учасники дискусії:', prompt)
        self.assertIn('Скептик', prompt)
        self.assertIn('Повна історія дискусії:', prompt)

    def test_prompt_contains_full_history(self):
        self.run_to_completion()
        final_prompt = self.provider.calls[-1]['prompt']
        self.assertIn('Тестова репліка #1', final_prompt)
        self.assertIn('Тестова репліка #9', final_prompt)
        self.assertIn('Логік', final_prompt)
        self.assertIn('Скептик', final_prompt)
        self.assertIn('Креативник', final_prompt)

    def test_yes_no_mode_flow(self):
        self.discussion.mode = Discussion.Mode.YES_NO
        self.discussion.save()
        self.run_to_completion()
        self.assertEqual(self.discussion.final_summary.get('answer'), 'так')
        self.assertIn('confirmed', self.discussion.final_summary)

    def test_choose_one_mode_flow(self):
        self.discussion.mode = Discussion.Mode.CHOOSE_ONE
        self.discussion.options = ['Купити', 'Не купувати', 'Зачекати']
        self.discussion.save()
        self.run_to_completion()
        self.assertEqual(
            self.discussion.best_solution.get('answer'),
            'Купити',
        )
        self.assertEqual(self.discussion.final_summary.get('answer'), 'Купити')
