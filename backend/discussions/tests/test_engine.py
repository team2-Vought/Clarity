import uuid
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from discussions.models import Discussion, Message
from discussions.serializers import DiscussionSerializer
from discussions.services import engine
from discussions.services.providers import ProviderError

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
        steps = 0
        while True:
            messages = engine.advance(
                self.discussion, provider_factory=self.provider_factory
            )
            self.discussion.refresh_from_db()
            if not messages and self.discussion.phase == Discussion.Phase.DONE:
                break
            steps += 1
            self.assertLess(steps, 50, 'движок не завершується')
        return steps

    def ai_messages(self, phase):
        return list(
            self.discussion.messages.filter(phase=phase, role=Message.Role.AI)
            .order_by('seq')
        )

    def test_full_flow_creates_all_phases(self):
        steps = self.run_to_completion()

        self.assertEqual(self.discussion.phase, Discussion.Phase.DONE)
        self.assertEqual(self.discussion.status, Discussion.Status.DONE)
        self.assertIsNotNone(self.discussion.best_solution)
        self.assertIsNotNone(self.discussion.devil_review)
        self.assertIsNotNone(self.discussion.final_summary)
        self.assertIsNotNone(self.discussion.finished_at)
        self.assertFalse(self.discussion.early_stop)
        self.assertIn('confirmed', self.discussion.final_summary)

        phases = set(self.discussion.messages.values_list('phase', flat=True))
        self.assertEqual(
            phases,
            {
                Discussion.Phase.OPENING,
                Discussion.Phase.DEBATE,
                Discussion.Phase.SYNTHESIS,
                Discussion.Phase.DEVIL,
                Discussion.Phase.REBUTTAL,
                Discussion.Phase.FINAL,
            },
        )
        # кроки: вступ (паралельно) + 3*2 дебати + синтез + devil + відповіді + фінал
        self.assertEqual(steps, 11)
        # user + 3 вступи + 6 дебатів + синтез + devil + 3 відповіді + фінал
        self.assertEqual(self.discussion.messages.count(), 16)

        synthesis = self.discussion.messages.get(phase=Discussion.Phase.SYNTHESIS)
        final = self.discussion.messages.get(phase=Discussion.Phase.FINAL)
        self.assertIn('\n\n', synthesis.content)
        self.assertIn('\n\n', final.content)

    def test_json_steps_request_json_mode(self):
        self.run_to_completion()
        json_calls = [call for call in self.provider.calls if call['json_mode']]
        self.assertEqual(len(json_calls), 3)
        text_calls = [call for call in self.provider.calls if not call['json_mode']]
        self.assertEqual(len(text_calls), 12)

    def test_openings_are_parallel_and_independent(self):
        messages = engine.advance(self.discussion, provider_factory=self.provider_factory)
        self.discussion.refresh_from_db()

        self.assertEqual(len(messages), 3)
        self.assertEqual(
            [message.persona_slug for message in messages],
            ['logician', 'skeptic', 'creative'],
        )
        self.assertTrue(all(message.reply_to == '' for message in messages))
        self.assertEqual(self.discussion.phase, Discussion.Phase.DEBATE)
        self.assertEqual(self.discussion.current_round, 1)
        for call in self.provider.calls:
            self.assertNotIn('Тестова репліка', call['prompt'])
            self.assertIn('одночасно', call['prompt'])

    def test_service_lines_are_stripped_and_stored(self):
        messages = engine.advance(self.discussion, provider_factory=self.provider_factory)
        for message in messages:
            self.assertNotIn('ТЕЗА', message.content)
            self.assertTrue(message.thesis.startswith('Теза репліки #'))

    def test_messages_have_sequential_unique_seq(self):
        self.run_to_completion()
        seqs = list(self.discussion.messages.order_by('seq').values_list('seq', flat=True))
        self.assertEqual(seqs, list(range(1, len(seqs) + 1)))

    def test_devil_message_present(self):
        self.run_to_completion()
        devil = self.discussion.messages.filter(role=Message.Role.DEVIL).first()
        self.assertIsNotNone(devil)
        self.assertTrue(devil.content.strip())

    def test_participants_respond_to_devil(self):
        self.run_to_completion()
        rebuttals = self.ai_messages(Discussion.Phase.REBUTTAL)
        self.assertEqual(
            [message.persona_slug for message in rebuttals],
            ['logician', 'skeptic', 'creative'],
        )
        self.assertTrue(all(message.reply_to_slug == 'devil' for message in rebuttals))
        devil = self.discussion.messages.get(phase=Discussion.Phase.DEVIL)
        self.assertTrue(all(message.seq > devil.seq for message in rebuttals))
        final_prompt = self.provider.calls[-1]['prompt']
        self.assertIn('[Відповідь на AI Devil]', final_prompt)

    def test_advance_after_done_returns_empty(self):
        self.run_to_completion()
        self.assertEqual(engine.advance(self.discussion), [])

    def test_failed_discussion_can_resume(self):
        self.discussion.status = Discussion.Status.FAILED
        self.discussion.save(update_fields=['status'])
        messages = engine.advance(
            self.discussion, provider_factory=self.provider_factory
        )
        self.discussion.refresh_from_db()
        self.assertTrue(messages)
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
        self.assertIn(0.2, [call['temperature'] for call in self.provider.calls])

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

        for _ in range(2):
            engine.advance(self.discussion, provider_factory=factory)
            self.discussion.refresh_from_db()

        self.assertEqual(
            sorted(used_models[:3]),
            sorted(
                [
                    'openai:gpt-6-luna',
                    'groq:openai/gpt-oss-120b',
                    'gemini:gemini-3.8-flash',
                ]
            ),
        )
        self.assertEqual(used_models[3], 'openai:gpt-6-luna')

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

        self.assertEqual(used_models, ['groq:openai/gpt-oss-120b'] * 3)

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
        self.discussion.refresh_from_db()
        engine.advance(self.discussion, provider_factory=self.provider_factory)

        call = next(
            call for call in self.provider.calls if 'Ім’я: Логік' in call['system']
        )
        self.assertIn('Темперамент: Спокійний, раціональний', call['system'])
        self.assertIn('Опис: Тримається фактів', call['system'])
        self.assertIn('Додатковий стиль від користувача: Ти — стратег.', call['system'])
        self.assertIn('Додаткові риси: Перфекціоніст, Стратег', call['system'])
        self.assertIn(self.discussion.question, call['prompt'])
        self.assertIn('Учасники дискусії:', call['prompt'])
        self.assertIn('Скептик', call['prompt'])
        # опис персони не дублюється в user-промпті
        self.assertNotIn('Темперамент: Спокійний', call['prompt'])

        debate_prompt = self.provider.calls[-1]['prompt']
        self.assertIn('Історія дискусії', debate_prompt)

    def test_traits_are_turned_into_behavior_rules(self):
        self.discussion.personas = [
            {
                'slug': 'logician',
                'name': 'Юрист',
                'traits': ['Перфекціоніст', 'Стратег'],
            },
            {'slug': 'skeptic'},
        ]
        self.discussion.save()
        engine.advance(self.discussion, provider_factory=self.provider_factory)

        call = next(
            call for call in self.provider.calls if 'Ім’я: Юрист' in call['system']
        )
        self.assertIn('Правила характеру:', call['system'])
        self.assertIn('Перфекціоніст', call['system'])
        self.assertIn('Помічай дрібні недоліки', call['system'])
        self.assertIn('Стратег', call['system'])
        self.assertIn('Твоя роль у цій дискусії:', call['system'])
        self.assertIn('Ти — Юрист.', call['prompt'])

    def test_debaters_reply_to_each_other(self):
        self.run_to_completion()
        debaters = self.ai_messages(Discussion.Phase.DEBATE)
        self.assertEqual(len(debaters), 6)
        self.assertTrue(all(message.reply_to for message in debaters))
        self.assertTrue(
            all(message.reply_to_slug != message.persona_slug for message in debaters)
        )
        debate_prompt = self.provider.calls[4]['prompt']
        self.assertIn('Ти відповідаєш учаснику «', debate_prompt)
        self.assertIn('→ відповідає', debate_prompt)

    def test_describe_step_names_what_each_step_works_on(self):
        opening = engine.describe_step(self.discussion)
        self.assertEqual([item['slug'] for item in opening], ['logician', 'skeptic', 'creative'])
        self.assertIn('Чи варто змінювати роботу на стартап?', opening[0]['text'])

        seen = set()
        while self.discussion.phase != Discussion.Phase.DONE:
            focus = engine.describe_step(self.discussion)
            self.assertTrue(focus, f'порожній опис у фазі {self.discussion.phase}')
            phase = self.discussion.phase
            created = engine.advance(self.discussion, provider_factory=self.provider_factory)
            self.discussion.refresh_from_db()
            seen.add(phase)
            if phase == Discussion.Phase.DEBATE:
                # опис називає саме того, кому учасник потім відповів, і його тезу
                (message,) = created
                self.assertEqual(focus[0]['slug'], message.persona_slug)
                self.assertIn(f'→ {message.reply_to} ·', focus[0]['text'])
                theses = self.discussion.messages.filter(
                    persona_slug=message.reply_to_slug, seq__lt=message.seq
                ).values_list('thesis', flat=True)
                self.assertTrue(any(f'«{thesis}»' in focus[0]['text'] for thesis in theses))
            if phase == Discussion.Phase.DEVIL:
                self.assertEqual(focus[0]['slug'], 'devil')
                self.assertIn('слабкі місця в рішенні «', focus[0]['text'])

        self.assertIn(Discussion.Phase.DEBATE, seen)
        self.assertEqual(engine.describe_step(self.discussion), [])

    def test_addressed_participant_answers_first(self):
        for _ in range(4):  # вступ + три репліки першого раунду
            engine.advance(self.discussion, provider_factory=self.provider_factory)
            self.discussion.refresh_from_db()
        first, second, third = self.ai_messages(Discussion.Phase.DEBATE)
        # Логік звернувся до Креативника, тож Креативник відповідає саме йому
        self.assertEqual(first.reply_to_slug, 'creative')
        self.assertEqual(third.persona_slug, 'creative')
        self.assertEqual(third.reply_to_slug, 'logician')
        self.assertIn('звернувся до тебе', self.provider.calls[-1]['prompt'])

    def test_reply_target_avoids_repeating_same_partner(self):
        self.run_to_completion()
        by_speaker = {}
        for message in self.ai_messages(Discussion.Phase.DEBATE):
            by_speaker.setdefault(message.persona_slug, []).append(message.reply_to_slug)
        for targets in by_speaker.values():
            self.assertEqual(len(targets), 2)

    def test_custom_participant_names_are_used(self):
        self.discussion.personas = [
            {'slug': 'logician', 'name': 'Анна'},
            {'slug': 'skeptic', 'name': 'Богдан'},
            {'slug': 'creative', 'name': 'Віра'},
        ]
        self.discussion.save()
        for _ in range(2):
            engine.advance(self.discussion, provider_factory=self.provider_factory)
            self.discussion.refresh_from_db()

        names = set(
            self.discussion.messages.filter(role=Message.Role.AI)
            .values_list('persona_name', flat=True)
        )
        self.assertEqual(names, {'Анна', 'Богдан', 'Віра'})
        debate_prompt = self.provider.calls[-1]['prompt']
        self.assertIn('Ти — Анна.', debate_prompt)
        self.assertIn('Віра', debate_prompt)

    def test_prompt_contains_full_history_for_moderator(self):
        self.run_to_completion()
        final_prompt = self.provider.calls[-1]['prompt']
        self.assertIn('Тестова репліка #1.', final_prompt)
        self.assertIn('Тестова репліка #9.', final_prompt)
        self.assertIn('Логік', final_prompt)
        self.assertIn('Скептик', final_prompt)
        self.assertIn('Креативник', final_prompt)

    def test_debate_history_compacts_old_replies(self):
        for _ in range(6):  # вступ + 5 реплік дебатів
            engine.advance(self.discussion, provider_factory=self.provider_factory)
            self.discussion.refresh_from_db()
        last_prompt = self.provider.calls[-1]['prompt']
        # 3 вступи + 4 репліки до цього кроку: 4 найстаріші — лише тезою
        self.assertEqual(last_prompt.count('— коротко: Теза репліки'), 4)
        self.assertEqual(last_prompt.count('Аргумент для перевірки контексту'), 3)

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

    def test_lease_blocks_parallel_advance(self):
        self.discussion.advance_token = uuid.uuid4()
        self.discussion.advance_started_at = timezone.now()
        self.discussion.save(update_fields=['advance_token', 'advance_started_at'])
        before = self.discussion.messages.count()

        with self.assertRaises(engine.EngineBusy):
            engine.advance(self.discussion, provider_factory=self.provider_factory)

        self.discussion.refresh_from_db()
        self.assertEqual(self.discussion.messages.count(), before)

    def test_expired_lease_can_be_reclaimed(self):
        self.discussion.advance_token = uuid.uuid4()
        self.discussion.advance_started_at = timezone.now() - timedelta(days=1)
        self.discussion.save(update_fields=['advance_token', 'advance_started_at'])

        messages = engine.advance(
            self.discussion, provider_factory=self.provider_factory
        )
        self.discussion.refresh_from_db()
        self.assertTrue(messages)
        self.assertIsNone(self.discussion.advance_token)
        self.assertEqual(self.discussion.status, Discussion.Status.IN_PROGRESS)

    def test_provider_failure_releases_lease_and_can_resume(self):
        def failing_factory(model_id):
            raise ProviderError('provider is down')

        with self.assertRaises(engine.EngineError):
            engine.advance(self.discussion, provider_factory=failing_factory)

        self.discussion.refresh_from_db()
        self.assertEqual(self.discussion.status, Discussion.Status.FAILED)
        self.assertIsNone(self.discussion.advance_token)
        self.assertIn('provider is down', self.discussion.error)

        messages = engine.advance(
            self.discussion, provider_factory=self.provider_factory
        )
        self.assertTrue(messages)
        self.discussion.refresh_from_db()
        self.assertEqual(self.discussion.status, Discussion.Status.IN_PROGRESS)

    def test_invalid_json_is_repaired(self):
        class RepairingProvider(FakeProvider):
            failed_once = False

            def complete(inner_self, *, system, prompt, temperature=0.7, json_mode=False):
                if '"supporting_arguments"' in prompt and not inner_self.failed_once:
                    inner_self.failed_once = True
                    inner_self.calls.append(
                        {
                            'system': system,
                            'prompt': prompt,
                            'temperature': temperature,
                        }
                    )
                    return 'Це не JSON, але модель виправиться.'
                return super().complete(
                    system=system,
                    prompt=prompt,
                    temperature=temperature,
                    json_mode=json_mode,
                )

        self.provider = RepairingProvider()
        self.run_to_completion()
        self.assertIsNotNone(self.discussion.final_summary)
        self.assertEqual(
            self.discussion.best_solution['decision'],
            'Тестове рішення',
        )

    @override_settings(LLM_HISTORY_MAX_CHARS=2000)
    def test_long_history_is_compacted_before_trimming(self):
        for index in range(3):
            self.discussion.messages.create(
                seq=2 + index,
                phase=Discussion.Phase.OPENING,
                role=Message.Role.AI,
                persona_slug='logician',
                persona_name='Логік',
                avatar='🧠',
                content='Дуже довга репліка для перевірки контексту. ' * 80,
            )
        self.run_to_completion()
        final_prompt = self.provider.calls[-1]['prompt']
        # давні репліки стиснуто до тез, а не викинуто
        self.assertNotIn('контексту. Дуже довга репліка', final_prompt)
        self.assertIn('Логік (AI-учасник) — коротко: Дуже довга репліка', final_prompt)
        self.assertIn('Тестова репліка #9.', final_prompt)

    @override_settings(LLM_HISTORY_MAX_CHARS=600)
    def test_history_trimmed_when_compaction_is_not_enough(self):
        self.run_to_completion()
        final_prompt = self.provider.calls[-1]['prompt']
        self.assertIn('Частину давніших повідомлень скорочено', final_prompt)

    def test_partial_parallel_failure_keeps_successful_replies(self):
        def factory(model_id):
            return self.provider

        class FlakyProvider(FakeProvider):
            def complete(inner_self, *, system, prompt, temperature=0.7, json_mode=False):
                if 'Ім’я: Скептик' in system:
                    raise ProviderError('skeptic model is down')
                return super().complete(
                    system=system, prompt=prompt, temperature=temperature
                )

        flaky = FlakyProvider()
        with self.assertRaises(engine.EngineError):
            engine.advance(self.discussion, provider_factory=lambda model_id: flaky)

        self.discussion.refresh_from_db()
        self.assertEqual(self.discussion.status, Discussion.Status.FAILED)
        self.assertEqual(self.discussion.phase, Discussion.Phase.OPENING)
        self.assertIsNone(self.discussion.advance_token)
        self.assertEqual(
            [m.persona_slug for m in self.ai_messages(Discussion.Phase.OPENING)],
            ['logician', 'creative'],
        )

        messages = engine.advance(self.discussion, provider_factory=factory)
        self.discussion.refresh_from_db()
        self.assertEqual([m.persona_slug for m in messages], ['skeptic'])
        self.assertEqual(self.discussion.phase, Discussion.Phase.DEBATE)
        self.assertEqual(self.discussion.status, Discussion.Status.IN_PROGRESS)


class ConsensusTests(TestCase):
    """Раннє завершення дебатів, коли всі учасники зайняли однакову позицію."""

    def setUp(self):
        self.user = User.objects.create_user(
            email='consensus@test.com', name='Тест', password='pass123!A'
        )

    def make(self, stance, *, mode=Discussion.Mode.YES_NO, rounds=3, options=None):
        self.provider = FakeProvider(stance=stance)
        discussion = Discussion.objects.create(
            user=self.user,
            question='Чи варто змінювати роботу на стартап?',
            personas=['logician', 'skeptic'],
            rounds=rounds,
            mode=mode,
            options=options or [],
        )
        while discussion.phase != Discussion.Phase.DONE:
            engine.advance(discussion, provider_factory=lambda model_id: self.provider)
            discussion.refresh_from_db()
        return discussion

    def debate_count(self, discussion):
        return discussion.messages.filter(phase=Discussion.Phase.DEBATE).count()

    def test_unanimous_yes_no_stops_after_first_round(self):
        discussion = self.make('так')
        self.assertTrue(discussion.early_stop)
        self.assertEqual(self.debate_count(discussion), 2)
        stances = set(
            discussion.messages.filter(role=Message.Role.AI).values_list('stance', flat=True)
        )
        self.assertEqual(stances, {'так'})
        synthesis_call = next(
            call for call in self.provider.calls if '"supporting_arguments"' in call['prompt']
            and '"verdict"' not in call['prompt'] and '"confirmed"' not in call['prompt']
        )
        self.assertIn('достроково', synthesis_call['prompt'])

    def test_no_stance_runs_all_rounds(self):
        discussion = self.make(None)
        self.assertFalse(discussion.early_stop)
        self.assertEqual(self.debate_count(discussion), 6)

    def test_last_round_is_not_marked_early(self):
        discussion = self.make('так', rounds=1)
        self.assertFalse(discussion.early_stop)
        self.assertEqual(self.debate_count(discussion), 2)

    def test_open_mode_needs_explicit_agreement(self):
        self.assertTrue(self.make('згода', mode=Discussion.Mode.OPEN).early_stop)
        self.assertFalse(self.make('суперечка', mode=Discussion.Mode.OPEN).early_stop)

    def test_choose_one_partial_option_match(self):
        discussion = self.make(
            '**Зачекати** — так безпечніше',
            mode=Discussion.Mode.CHOOSE_ONE,
            options=['Купити', 'Не купувати', 'Зачекати'],
        )
        self.assertTrue(discussion.early_stop)
        stance = discussion.messages.filter(role=Message.Role.AI).first().stance
        self.assertEqual(stance, 'Зачекати')


class ParseReplyTests(TestCase):
    def parse(self, raw, mode=Discussion.Mode.OPEN, options=None):
        reply = engine.parse_reply(raw, mode, options or [])
        return reply['content'], reply['thesis'], reply['stance']

    def test_markdown_service_lines(self):
        content, thesis, stance = self.parse(
            'Перший абзац.\n\nДругий абзац.\n\n**ТЕЗА:** Головна думка\n**Позиція:** Ні.',
            Discussion.Mode.YES_NO,
        )
        self.assertEqual(content, 'Перший абзац.\n\nДругий абзац.')
        self.assertEqual(thesis, 'Головна думка')
        self.assertEqual(stance, 'ні')

    def test_missing_thesis_falls_back_to_first_sentence(self):
        content, thesis, stance = self.parse('Коротка думка. Далі пояснення.')
        self.assertEqual(content, 'Коротка думка. Далі пояснення.')
        self.assertEqual(thesis, 'Коротка думка.')
        self.assertEqual(stance, '')

    def test_ambiguous_choose_one_stance_is_empty(self):
        _, _, stance = self.parse(
            'Текст.\nПОЗИЦІЯ: Купити або Зачекати',
            Discussion.Mode.CHOOSE_ONE,
            ['Купити', 'Зачекати'],
        )
        self.assertEqual(stance, '')

    def test_body_line_does_not_hijack_service_stance(self):
        content, _, stance = self.parse(
            'Позиція: так, але лише за умови резерву.\n\nДругий абзац.\n\n'
            'ТЕЗА: Потрібен резерв\nПОЗИЦІЯ: ні',
            Discussion.Mode.YES_NO,
        )
        self.assertEqual(stance, 'ні')
        self.assertIn('Позиція: так, але лише за умови резерву.', content)
        self.assertNotIn('ПОЗИЦІЯ: ні', content)

    def test_search_line_is_extracted(self):
        reply = engine.parse_reply(
            'Текст.\n\nТЕЗА: Теза\nПОШУК: «середня зарплата Київ 2026»',
            Discussion.Mode.OPEN,
            [],
        )
        self.assertEqual(reply['search_query'], 'середня зарплата Київ 2026')
        self.assertEqual(reply['content'], 'Текст.')


class StructuredTextTests(TestCase):
    """Тексти модератора й AI Devil — markdown із заголовками та списками."""

    def test_devil_text_has_sections(self):
        text = engine.texts._devil_text({
            'verdict': 'Рішення ризиковане',
            'risks': [{'title': 'Касовий розрив', 'description': 'грошей на 3 місяці.', 'severity': 'висока'}],
            'weak_spots': ['Немає плану Б.'],
            'counter_arguments': [],
        })
        self.assertTrue(text.startswith('**Рішення ризиковане**'))
        self.assertIn('### Ризики\n\n- **Касовий розрив** — грошей на 3 місяці _(ризик: висока)_', text)
        self.assertIn('### Слабкі місця\n\n- Немає плану Б', text)
        self.assertNotIn('Контраргументи', text)

    def test_markdown_reply_keeps_formatting_and_plain_thesis(self):
        reply = engine.parse_reply(
            '**Не варто** переходити зараз.\n\n- ризик перший\n- ризик другий\n\nПОЗИЦІЯ: суперечка',
            Discussion.Mode.OPEN,
            [],
        )
        self.assertIn('- ризик перший\n- ризик другий', reply['content'])
        self.assertEqual(reply['thesis'], 'Не варто переходити зараз.')


class LiveStatusTests(EngineTests):
    """Рядок «що зараз роблять AI» і поточний пошуковий запит."""

    def claim_step(self):
        token = uuid.uuid4()
        Discussion.objects.filter(pk=self.discussion.pk).update(
            advance_token=token, advance_started_at=timezone.now(), live_token=token
        )
        self.discussion.refresh_from_db()
        return engine.live._live.set((self.discussion.pk, token))

    def live(self):
        self.discussion.refresh_from_db()
        return DiscussionSerializer(self.discussion).data['live']

    def test_clean_status_keeps_one_short_line(self):
        raw = '<think>хм, треба коротко</think>\n«зважуємо ризики переходу в стартап».\nПояснення'
        self.assertEqual(engine.clean_status(raw), 'Зважуємо ризики переходу в стартап…')
        self.assertEqual(engine.clean_status('   \n'), '')
        self.assertLessEqual(len(engine.clean_status('слово ' * 40)), engine.live.STATUS_LIMIT + 1)

    def test_ai_status_and_search_are_live_only_during_the_step(self):
        provider = mock.Mock()
        provider.complete.return_value = 'Порівнюємо стартап зі стабільною роботою'
        live = self.claim_step()
        try:
            # фоновий потік закриває своє з'єднання; у тесті воно спільне
            with mock.patch('discussions.services.engine.status.connection'):
                engine.status._write_ai_status(
                    self.discussion, engine.describe_step(self.discussion), lambda model_id: provider
                )
            prompt = provider.complete.call_args.kwargs['prompt']
            self.assertIn('Чи варто змінювати роботу на стартап?', prompt)

            seen = []

            def search(query):
                seen.append(self.live()['search'])
                return []

            with mock.patch('discussions.services.search.search', side_effect=search):
                engine.calls._run_searches(['зарплати в стартапах'])
        finally:
            engine.live._live.reset(live)

        self.assertEqual(seen, ['зарплати в стартапах'])
        self.assertEqual(
            self.live(),
            {'status': 'Порівнюємо стартап зі стабільною роботою…', 'search': '', 'drafts': []},
        )

        Discussion.objects.filter(pk=self.discussion.pk).update(advance_token=None)
        self.assertEqual(self.live(), {'status': '', 'search': '', 'drafts': []})

    def test_status_failure_is_silent(self):
        provider = mock.Mock()
        provider.complete.side_effect = ProviderError('down')
        live = self.claim_step()
        try:
            with mock.patch('discussions.services.engine.status.connection'):
                engine.status._write_ai_status(
                    self.discussion, engine.describe_step(self.discussion), lambda model_id: provider
                )
        finally:
            engine.live._live.reset(live)
        self.assertEqual(self.live()['status'], '')


class StreamingProvider(FakeProvider):
    """Віддає репліки учасників шматками через on_text, як справжній потік."""

    supports_streaming = True

    def __init__(self, on_chunk=None, **kwargs):
        super().__init__(**kwargs)
        self.streaming = False
        self.on_chunk = on_chunk

    def complete(self, *, system, prompt, temperature=0.7, json_mode=False, on_text=None):
        text = super().complete(
            system=system, prompt=prompt, temperature=temperature, json_mode=json_mode
        )
        if on_text is not None and self.streaming:
            for end in range(1, len(text) + 1):
                on_text(text[:end])
                if self.on_chunk is not None:
                    self.on_chunk(text[:end])
        return text


@override_settings(DISCUSSION_AI_STATUS=False)
class StreamingTests(EngineTests):
    def setUp(self):
        super().setUp()
        self.seen = []
        self.provider = StreamingProvider(on_chunk=self.capture)

    def capture(self, raw):
        discussion = Discussion.objects.get(pk=self.discussion.pk)
        live = DiscussionSerializer(discussion).data['live']
        self.seen.append((raw, live['drafts']))

    def test_debate_reply_is_visible_while_it_is_written(self):
        # вступ іде паралельно — потоки; потік перевіряємо на кроці дебатів
        engine.advance(self.discussion, provider_factory=self.provider_factory)
        self.discussion.refresh_from_db()
        self.provider.streaming = True
        with mock.patch.object(engine.live, 'DRAFT_FLUSH_SECONDS', 0):
            [message] = engine.advance(self.discussion, provider_factory=self.provider_factory)

        drafts = [drafts for _, drafts in self.seen if drafts]
        self.assertTrue(drafts, 'чернетка не з’явилась під час генерації')
        last = drafts[-1][0]
        self.assertEqual(last['slug'], message.persona_slug)
        self.assertEqual(last['phase'], Discussion.Phase.DEBATE)
        self.assertEqual(last['text'], message.content)
        # службові рядки не потрапляють у чернетку навіть недописаними
        for [draft] in drafts:
            self.assertNotIn('ТЕЗ', draft['text'])

        self.discussion.refresh_from_db()
        self.assertEqual(self.discussion.live_drafts, [])
        self.assertEqual(DiscussionSerializer(self.discussion).data['live']['drafts'], [])

    def test_providers_without_streaming_get_no_callback(self):
        plain = FakeProvider()
        engine.advance(self.discussion, provider_factory=lambda model_id: plain)
        self.discussion.refresh_from_db()
        self.assertEqual(self.discussion.live_drafts, [])


class DraftTextTests(TestCase):
    def test_service_lines_and_thinking_are_hidden(self):
        raw = '<think>міркую</think>Перший абзац.\n\nДругий.\nТЕЗА: головне\nПОЗИЦІЯ: згода'
        self.assertEqual(engine.draft_text(raw), 'Перший абзац.\n\nДругий.')

    def test_unclosed_thinking_shows_nothing(self):
        self.assertEqual(engine.draft_text('<think>ще думаю над'), '')

    def test_service_word_being_typed_is_hidden(self):
        self.assertEqual(engine.draft_text('Абзац.\n\nTHES'), 'Абзац.')
        self.assertEqual(engine.draft_text('Абзац.\n**ПОЗИЦ'), 'Абзац.')

    def test_ordinary_words_stay(self):
        self.assertEqual(engine.draft_text('Абзац.\nТак'), 'Абзац.\nТак')
