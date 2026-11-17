"""Тести виправлень логіки дебатів, пошуку, уточнень і фонового раннера."""

import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from discussions.models import Discussion, Message
from discussions.personas import CONSENSUS_MAX_ROUNDS
from discussions.services import engine, runner
from discussions.services.engine.context import _model_for_persona, _resolved_personas
from discussions.services.providers import ProviderError

from .fakes import FakeProvider

User = get_user_model()

KEYS = {
    'LLM_OPENAI_API_KEY': 'sk-test',
    'LLM_ANTHROPIC_API_KEY': 'sk-ant-test',
    'LLM_GEMINI_API_KEY': '',
    'LLM_GROQ_API_KEY': 'gsk-test',
    'LLM_CEREBRAS_API_KEY': '',
    'LLM_DEEPSEEK_API_KEY': '',
    'LLM_MISTRAL_API_KEY': '',
    'LLM_OPENROUTER_API_KEY': '',
    'LLM_OLLAMA_MODELS': [],
    'LLM_CUSTOM_BASE_URL': '',
    'LLM_CUSTOM_MODEL': '',
    'LLM_MODERATOR_MODEL': '',
    'LLM_DEVIL_MODEL': '',
}

FAKE_RESULTS = [
    {'title': 'Статистика зарплат', 'url': 'https://example.com/salary', 'snippet': 'Медіана 50 000 грн.'},
    {'title': 'Ринок стартапів', 'url': 'https://example.com/startups', 'snippet': '90% стартапів закриваються.'},
]


class Base(TestCase):
    def setUp(self):
        self.provider = FakeProvider()
        self.user = User.objects.create_user(
            email='v3@test.com', name='Оксана', password='pass123!A'
        )

    def make(self, **kwargs):
        defaults = {
            'user': self.user,
            'question': 'Чи варто змінювати роботу на стартап?',
            'personas': ['logician', 'skeptic', 'creative'],
            'rounds': 2,
        }
        defaults.update(kwargs)
        discussion = Discussion.objects.create(**defaults)
        discussion.messages.create(
            seq=1,
            phase=Discussion.Phase.OPENING,
            role=Message.Role.USER,
            persona_slug='user',
            persona_name='Оксана',
            avatar='🧑',
            content=discussion.question,
        )
        return discussion

    def step(self, discussion, factory=None):
        created = engine.advance(discussion, provider_factory=factory or (lambda m: self.provider))
        discussion.refresh_from_db()
        return created

    def finish(self, discussion, factory=None):
        for _ in range(60):
            if discussion.phase == Discussion.Phase.DONE:
                return
            self.step(discussion, factory)
        self.fail('дискусія не завершилась')

    def judge_calls(self, marker):
        return [call for call in self.provider.calls if marker in call['prompt']]


class AnswerValidationTests(Base):
    def test_missing_answer_triggers_repair_in_yes_no_mode(self):
        class NoAnswerOnce(FakeProvider):
            dropped = False

            def _synthesis(inner, prompt):
                data = super()._synthesis(prompt)
                if not inner.dropped:
                    inner.dropped = True
                    data.pop('answer')
                return data

        self.provider = NoAnswerOnce()
        discussion = self.make(mode=Discussion.Mode.YES_NO)
        self.finish(discussion)
        repair = [call for call in self.provider.calls if 'ВАЖЛИВО' in call['prompt']]
        self.assertEqual(len(repair), 1)
        self.assertIn('"answer"', repair[0]['prompt'])
        self.assertEqual(discussion.best_solution['answer'], 'так')

    def test_answer_derived_from_decision_when_repair_fails(self):
        class NeverAnswers(FakeProvider):
            def _synthesis(inner, prompt):
                data = super()._synthesis(prompt)
                data.pop('answer', None)
                data['decision'] = 'Зачекати пів року'
                return data

        self.provider = NeverAnswers()
        discussion = self.make(
            mode=Discussion.Mode.CHOOSE_ONE, options=['Купити', 'Зачекати']
        )
        self.finish(discussion)
        self.assertEqual(discussion.best_solution['answer'], 'Зачекати')

    def test_changed_answer_marks_summary_as_revised(self):
        class FlipsAnswer(FakeProvider):
            def _final(inner, prompt):
                data = super()._final(prompt)
                data['answer'] = 'ні'
                data['confirmed'] = True
                return data

        self.provider = FlipsAnswer()
        discussion = self.make(mode=Discussion.Mode.YES_NO)
        self.finish(discussion)
        summary = discussion.final_summary
        self.assertFalse(summary['confirmed'])
        self.assertIn('«так» на «ні»', summary['revision'])

    def test_unknown_confirmation_is_not_reported_as_revision(self):
        class NoConfirmed(FakeProvider):
            def _final(inner, prompt):
                data = super()._final(prompt)
                data.pop('confirmed')
                return data

        self.provider = NoConfirmed()
        discussion = self.make()
        self.finish(discussion)
        self.assertIsNone(discussion.final_summary['confirmed'])
        final = discussion.messages.get(phase=Discussion.Phase.FINAL)
        self.assertNotIn('переглянуто', final.content)

    def test_raw_json_never_leaks_into_messages(self):
        class Sparse(FakeProvider):
            def _synthesis(inner, prompt):
                return {'decision': 'Рішення без обґрунтування'}

            def _devil(inner):
                return {'risks': ['Ризик без вердикту']}

            def _final(inner, prompt):
                return {'decision': 'Фінал', 'confirmed': True}

        self.provider = Sparse()
        discussion = self.make()
        self.finish(discussion)
        for message in discussion.messages.exclude(role=Message.Role.AI):
            self.assertNotIn('{"', message.content)
        self.assertEqual(discussion.best_solution['reasoning'], '')


class ConsensusAndOrderTests(Base):
    def test_open_mode_needs_two_rounds_of_agreement(self):
        self.provider = FakeProvider(stance='згода')
        discussion = self.make(mode=Discussion.Mode.OPEN, rounds=3)
        self.finish(discussion)
        rounds = set(
            discussion.messages.filter(phase=Discussion.Phase.DEBATE).values_list('round', flat=True)
        )
        self.assertEqual(rounds, {1, 2})
        self.assertTrue(discussion.early_stop)

    def test_speaker_order_rotates_each_round(self):
        discussion = self.make()
        self.finish(discussion)
        order = {}
        for message in discussion.messages.filter(phase=Discussion.Phase.DEBATE).order_by('seq'):
            order.setdefault(message.round, []).append(message.persona_slug)
        self.assertEqual(order[1], ['logician', 'skeptic', 'creative'])
        self.assertEqual(order[2], ['skeptic', 'creative', 'logician'])

    def test_dissent_is_shown_to_user(self):
        class Dissent(FakeProvider):
            def _synthesis(inner, prompt):
                data = super()._synthesis(prompt)
                data['dissenting_points'] = ['Скептик вважає ризик завеликим']
                return data

        self.provider = Dissent()
        discussion = self.make()
        self.finish(discussion)
        synthesis = discussion.messages.get(phase=Discussion.Phase.SYNTHESIS)
        self.assertIn(
            '### Що лишилось спірним\n\n- Скептик вважає ризик завеликим', synthesis.content
        )
        self.assertEqual(
            discussion.final_summary['dissenting_points'], ['Скептик вважає ризик завеликим']
        )

    def test_agreement_is_computed_from_stances(self):
        self.provider = FakeProvider(stance='так')
        discussion = self.make(mode=Discussion.Mode.YES_NO, rounds=1)
        self.finish(discussion)
        agreement = discussion.final_summary['agreement']
        self.assertEqual(
            {key: agreement[key] for key in ('agree', 'disagree', 'unknown', 'total')},
            {'agree': 3, 'disagree': 0, 'unknown': 0, 'total': 3},
        )
        self.assertEqual(len(agreement['votes']), 3)
        self.assertTrue(all(vote['stance'] == 'так' and vote['name'] for vote in agreement['votes']))


@override_settings(**KEYS)
class JudgeModelTests(Base):
    def test_judges_use_neutral_and_distinct_models(self):
        used = []

        def factory(model_id):
            used.append(model_id)
            return self.provider

        discussion = self.make(
            personas=[
                {'slug': 'logician', 'model': 'openai:gpt-6-luna'},
                {'slug': 'skeptic', 'model': 'openai:gpt-6-luna'},
            ],
            rounds=1,
        )
        self.finish(discussion, factory)
        persona_calls = 2 + 2  # вступ + раунд
        synthesis_model = used[persona_calls]
        devil_model = used[persona_calls + 1]
        self.assertNotEqual(synthesis_model, 'openai:gpt-6-luna')
        self.assertNotEqual(devil_model, synthesis_model)

    def test_explicit_judge_models_are_respected(self):
        used = []

        def factory(model_id):
            used.append(model_id)
            return self.provider

        discussion = self.make(
            personas=['logician', 'skeptic'],
            rounds=1,
            moderator_model='anthropic:claude-opus-5-5',
            devil_model='groq:openai/gpt-oss-120b',
        )
        self.finish(discussion, factory)
        self.assertEqual(used[4], 'anthropic:claude-opus-5-5')
        self.assertEqual(used[5], 'groq:openai/gpt-oss-120b')

    def test_judge_falls_back_to_next_model(self):
        broken = 'anthropic:claude-opus-5-5'

        def factory(model_id):
            if model_id == broken:
                raise ProviderError('down')
            return self.provider

        discussion = self.make(personas=['logician', 'skeptic'], rounds=1, moderator_model=broken)
        self.finish(discussion, factory)
        self.assertEqual(discussion.status, Discussion.Status.DONE)

    def test_config_error_is_public_and_not_retryable(self):
        def factory(model_id):
            raise ProviderError('401 secret-key-123', status=401)

        discussion = self.make(personas=[{'slug': 'logician', 'model': 'openai:gpt-6-luna'}, 'skeptic'])
        with self.assertRaises(engine.EngineError) as ctx:
            self.step(discussion, factory)
        self.assertFalse(ctx.exception.retryable)
        discussion.refresh_from_db()
        self.assertEqual(discussion.error_code, 'provider_config')
        self.assertIn('OpenAI — GPT-6 Luna', discussion.error_public)
        self.assertNotIn('secret-key-123', discussion.error_public)

    def test_quota_error_has_own_code(self):
        def factory(model_id):
            raise ProviderError('You exceeded your current quota', status=429, quota=True)

        discussion = self.make(personas=[{'slug': 'logician', 'model': 'openai:gpt-6-luna'}, 'skeptic'])
        with self.assertRaises(engine.EngineError) as ctx:
            self.step(discussion, factory)
        self.assertFalse(ctx.exception.retryable)
        discussion.refresh_from_db()
        self.assertEqual(discussion.error_code, 'provider_quota')
        self.assertIn('вичерпано квоту', discussion.error_public)


@override_settings(SEARCH_PROVIDER='wikipedia', SEARCH_MAX_QUERIES=5)
class WebSearchTests(Base):
    def test_no_forced_search_before_opening(self):
        # пошук увімкнено, але учасникам фактів вистачає — ніхто нічого не шукає
        discussion = self.make(web_search=True, rounds=1)
        with mock.patch('discussions.services.search.search', return_value=FAKE_RESULTS) as found:
            self.step(discussion)
        found.assert_not_called()
        self.assertEqual(discussion.phase, Discussion.Phase.DEBATE)
        self.assertFalse(discussion.messages.filter(role=Message.Role.RESEARCH).exists())
        self.assertEqual(discussion.search_count, 0)
        self.assertIn('ПОШУК:', self.provider.calls[-1]['prompt'])

    def test_found_sources_reach_later_replies(self):
        self.provider = FakeProvider(search_query='медіанна зарплата IT 2026')
        discussion = self.make(web_search=True, rounds=1)
        with mock.patch('discussions.services.search.search', return_value=FAKE_RESULTS):
            self.step(discussion)  # вступ: учасник сам попросив пошук
            self.step(discussion)  # перша репліка дебатів уже бачить джерела
        debate_prompt = self.provider.calls[-1]['prompt']
        self.assertIn('<web_sources>', debate_prompt)
        self.assertIn('[1] Статистика зарплат (example.com)', debate_prompt)

    def test_participant_search_line_adds_sources(self):
        self.provider = FakeProvider(search_query='медіанна зарплата IT 2026')
        discussion = self.make(web_search=True, rounds=1)
        with mock.patch('discussions.services.search.search', return_value=FAKE_RESULTS):
            self.step(discussion)
        searched = discussion.messages.exclude(search_query='').get()
        self.assertEqual(searched.search_query, 'медіанна зарплата IT 2026')
        self.assertEqual(searched.source_ids, [1, 2])
        self.assertEqual(len(discussion.sources), 2)

    def test_search_budget_disables_search_line(self):
        discussion = self.make(web_search=True, search_count=5)
        self.step(discussion)
        self.assertNotIn('ПОШУК:', self.provider.calls[-1]['prompt'])

    def test_search_failure_does_not_break_debate(self):
        from discussions.services.search import SearchError

        self.provider = FakeProvider(search_query='медіанна зарплата IT 2026')
        discussion = self.make(web_search=True)
        with mock.patch('discussions.services.search.search', side_effect=SearchError('down')):
            self.step(discussion)
        self.assertEqual(discussion.phase, Discussion.Phase.DEBATE)
        self.assertEqual(discussion.sources, [])

    def test_search_off_hides_search(self):
        with override_settings(SEARCH_PROVIDER='off'):
            discussion = self.make(web_search=True)
            self.step(discussion)
            self.assertNotIn('ПОШУК:', self.provider.calls[-1]['prompt'])


class UserNotesTests(Base):
    def test_note_during_debate_is_answered(self):
        discussion = self.make(rounds=2)
        self.step(discussion)  # вступ
        engine.add_user_message(discussion.pk, 'Оксана', 'У мене є кредит на 3 роки.')
        self.step(discussion)
        debate = discussion.messages.filter(phase=Discussion.Phase.DEBATE, role=Message.Role.AI)
        first = debate.first()
        self.assertEqual(first.reply_to_slug, 'user')
        self.assertEqual(first.reply_to, 'Оксана')
        prompt = self.provider.calls[-1]['prompt']
        self.assertIn('У мене є кредит на 3 роки.', prompt)
        self.assertIn('Нові уточнення користувача', prompt)

        self.step(discussion)
        second = debate.all()[1]
        self.assertNotEqual(second.reply_to_slug, 'user')

    def test_question_is_not_duplicated_in_history(self):
        discussion = self.make()
        self.step(discussion)
        self.step(discussion)
        prompt = self.provider.calls[-1]['prompt']
        self.assertEqual(prompt.count(discussion.question), 1)

    @override_settings(DISCUSSION_MAX_FOLLOWUPS=1)
    def test_followup_after_final_reopens_debate(self):
        discussion = self.make(rounds=1)
        self.finish(discussion)
        first_rebuttals = discussion.messages.filter(phase=Discussion.Phase.REBUTTAL).count()

        message, reopened = engine.add_user_message(
            discussion.pk, 'Оксана', 'А якщо стартап дасть опціони?'
        )
        discussion.refresh_from_db()
        self.assertTrue(reopened)
        self.assertEqual(message.round, 2)
        self.assertEqual(discussion.phase, Discussion.Phase.DEBATE)
        self.assertEqual(discussion.rounds, 2)

        self.finish(discussion)
        self.assertEqual(discussion.status, Discussion.Status.DONE)
        rebuttals = discussion.messages.filter(phase=Discussion.Phase.REBUTTAL).count()
        self.assertEqual(rebuttals, first_rebuttals * 2)
        self.assertEqual(discussion.messages.filter(phase=Discussion.Phase.FINAL).count(), 2)
        final_prompt = self.provider.calls[-1]['prompt']
        self.assertIn('А якщо стартап дасть опціони?', final_prompt)

        with self.assertRaises(engine.EngineError) as ctx:
            engine.add_user_message(discussion.pk, 'Оксана', 'Ще одне питання')
        self.assertEqual(ctx.exception.code, 'followup_limit')


class RunnerTests(Base):
    def test_runner_completes_discussion(self):
        discussion = self.make(rounds=1)
        runner.run(discussion.pk, provider_factory=lambda m: self.provider)
        discussion.refresh_from_db()
        self.assertEqual(discussion.phase, Discussion.Phase.DONE)

    def test_runner_respects_stop(self):
        discussion = self.make(rounds=1, stop_requested=True)
        runner.run(discussion.pk, provider_factory=lambda m: self.provider)
        self.assertEqual(self.provider.calls, [])

    @override_settings(DISCUSSION_RUNNER_RETRY_DELAY_SECONDS=0)
    def test_runner_retries_transient_errors_only(self):
        attempts = []

        def flaky(model_id):
            attempts.append(model_id)
            if len(attempts) <= 3:
                raise ProviderError('timeout')
            return self.provider

        discussion = self.make(personas=['logician', 'skeptic'], rounds=1)
        runner.run(discussion.pk, provider_factory=flaky)
        discussion.refresh_from_db()
        self.assertEqual(discussion.phase, Discussion.Phase.DONE)

        def broken(model_id):
            raise ProviderError('bad key', status=401)

        # без заміни моделі: інакше учасники пробували б запасні
        self.user.preferences = {'model_fallback': False}
        self.user.save(update_fields=['preferences'])
        other = self.make(personas=['logician', 'skeptic'], rounds=1)
        calls = []

        def counting(model_id):
            calls.append(model_id)
            return broken(model_id)

        runner.run(other.pk, provider_factory=counting)
        other.refresh_from_db()
        self.assertEqual(other.status, Discussion.Status.FAILED)
        self.assertEqual(len(calls), 2)  # один крок вступу, без повторів


# без ключів у середовищі (CI) резервної моделі немає — даємо фіктивні
@override_settings(**KEYS)
class ModelFallbackTests(Base):
    def failing(self, broken_model):
        calls = []

        def factory(model_id):
            calls.append(model_id)
            if model_id == broken_model:
                raise ProviderError('quota', status=429)
            return self.provider

        return factory, calls

    def test_participant_switches_to_another_model_when_its_own_fails(self):
        discussion = self.make(personas=['logician', 'skeptic'], rounds=1)
        broken = _model_for_persona(_resolved_personas(discussion)[0])
        factory, calls = self.failing(broken)
        runner.run(discussion.pk, provider_factory=factory)
        discussion.refresh_from_db()
        self.assertEqual(discussion.phase, Discussion.Phase.DONE)
        self.assertIn(broken, calls)
        # репліки «зламаного» учасника збережено з моделлю, що справді відповіла
        own = discussion.messages.filter(persona_slug='logician').values_list('model_id', flat=True)
        self.assertTrue(own)
        self.assertNotIn(broken, set(own))

    def test_fallback_can_be_turned_off(self):
        self.user.preferences = {'model_fallback': False}
        self.user.save(update_fields=['preferences'])
        discussion = self.make(personas=['logician', 'skeptic'], rounds=1)
        broken = _model_for_persona(_resolved_personas(discussion)[0])
        factory, _ = self.failing(broken)
        runner.run(discussion.pk, provider_factory=factory)
        discussion.refresh_from_db()
        self.assertEqual(discussion.status, Discussion.Status.FAILED)


class UntilConsensusTests(Base):
    def debate_rounds(self, discussion):
        return set(
            discussion.messages.filter(phase=Discussion.Phase.DEBATE).values_list('round', flat=True)
        )

    def test_without_agreement_debates_up_to_the_cap(self):
        discussion = self.make(rounds=CONSENSUS_MAX_ROUNDS, until_consensus=True)
        self.finish(discussion)
        self.assertEqual(self.debate_rounds(discussion), set(range(1, CONSENSUS_MAX_ROUNDS + 1)))
        self.assertFalse(discussion.early_stop)
        self.assertTrue(discussion.final_summary)

    def test_stops_as_soon_as_everyone_agrees(self):
        self.provider = FakeProvider(stance='так')
        discussion = self.make(
            mode=Discussion.Mode.YES_NO, rounds=CONSENSUS_MAX_ROUNDS, until_consensus=True
        )
        self.finish(discussion)
        self.assertEqual(self.debate_rounds(discussion), {1})
        self.assertTrue(discussion.early_stop)

    def test_agreement_in_the_last_allowed_round_counts(self):
        class AgreeLate(FakeProvider):
            def complete(inner, **kwargs):
                # вступ і перший раунд — без позиції, далі всі кажуть «так»
                if inner.counter >= 6:
                    inner.stance = 'так'
                return super().complete(**kwargs)

        self.provider = AgreeLate()
        discussion = self.make(mode=Discussion.Mode.YES_NO, rounds=3, until_consensus=True)
        self.finish(discussion)
        self.assertEqual(self.debate_rounds(discussion), {1, 2, 3})
        self.assertTrue(discussion.early_stop)

    def test_participants_are_told_to_seek_agreement(self):
        discussion = self.make(rounds=CONSENSUS_MAX_ROUNDS, until_consensus=True)
        while discussion.phase != Discussion.Phase.SYNTHESIS:
            self.step(discussion)
        debate_calls = self.judge_calls('Мета цієї дискусії — дійти спільного висновку')
        self.assertTrue(debate_calls)
        self.assertIn('доки всі учасники не дійдуть одного висновку', debate_calls[0]['prompt'])

    def test_regular_rounds_do_not_push_for_agreement(self):
        discussion = self.make(rounds=2)
        self.finish(discussion)
        self.assertFalse(self.judge_calls('Мета цієї дискусії — дійти спільного висновку'))


class FinishEarlyTests(Base):
    def test_finish_ends_at_once_without_moderator(self):
        discussion = self.make(rounds=3)
        self.step(discussion)
        self.assertEqual(discussion.phase, Discussion.Phase.DEBATE)
        before = discussion.messages.count()

        engine.finish_early(discussion.pk)
        discussion.refresh_from_db()
        self.assertEqual(discussion.phase, Discussion.Phase.DONE)
        self.assertEqual(discussion.status, Discussion.Status.DONE)
        self.assertIsNotNone(discussion.finished_at)
        self.assertTrue(discussion.finished_early)
        self.assertIsNone(discussion.final_summary)
        self.assertEqual(discussion.messages.count(), before)
        self.assertFalse(discussion.messages.filter(role=Message.Role.MODERATOR).exists())

    def test_finish_during_rebuttal_skips_final(self):
        discussion = self.make(rounds=1)
        while discussion.phase != Discussion.Phase.REBUTTAL:
            self.step(discussion)
        engine.finish_early(discussion.pk)
        discussion.refresh_from_db()
        self.assertEqual(discussion.phase, Discussion.Phase.DONE)
        self.assertIsNone(discussion.final_summary)

    def test_finish_twice_is_rejected(self):
        discussion = self.make(rounds=2)
        self.step(discussion)
        engine.finish_early(discussion.pk)
        with self.assertRaises(engine.EngineError) as ctx:
            engine.finish_early(discussion.pk)
        self.assertEqual(ctx.exception.code, 'bad_state')

    def test_cannot_finish_before_anyone_spoke(self):
        discussion = self.make()
        with self.assertRaises(engine.EngineError) as ctx:
            engine.finish_early(discussion.pk)
        self.assertEqual(ctx.exception.code, 'nothing_to_finish')

    def test_followup_after_early_finish_runs_full_flow_again(self):
        discussion = self.make(rounds=2)
        self.step(discussion)
        engine.finish_early(discussion.pk)
        discussion.refresh_from_db()
        engine.add_user_message(discussion.pk, 'Оксана', 'А якщо зарплата вдвічі більша?')
        discussion.refresh_from_db()
        self.assertFalse(discussion.finished_early)


@override_settings(DISCUSSION_RUNNER_SYNC=True)
class ApiV3Tests(TestCase):
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
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='apiv3@test.com', name='Оксана', password='pass123!A'
        )
        self.client.force_authenticate(self.user)

    def create(self, **extra):
        payload = {
            'question': 'Чи варто запускати власний продукт?',
            'personas': ['logician', 'skeptic'],
            'rounds': 2,
            **extra,
        }
        response = self.client.post('/api/discussions/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_run_completes_and_polling_returns_only_new_messages(self):
        created = self.create()
        self.assertNotIn('context', created)
        run = self.client.post(f'/api/discussions/{created["id"]}/run/')
        self.assertEqual(run.status_code, 202)
        detail = self.client.get(f'/api/discussions/{created["id"]}/?after=5')
        self.assertTrue(detail.data['is_finished'])
        self.assertTrue(all(m['seq'] > 5 for m in detail.data['messages']))
        self.assertIn('agreement', detail.data['final_summary'])

    def test_stop_then_run(self):
        created = self.create()
        stop = self.client.post(f'/api/discussions/{created["id"]}/stop/')
        self.assertTrue(stop.data['stop_requested'])
        run = self.client.post(f'/api/discussions/{created["id"]}/run/')
        self.assertFalse(run.data['stop_requested'])
        self.assertTrue(run.data['is_finished'])

    def test_create_until_consensus_uses_the_round_cap(self):
        created = self.create(until_consensus=True, rounds=3)
        self.assertTrue(created['until_consensus'])
        self.assertEqual(created['rounds'], CONSENSUS_MAX_ROUNDS)
        limits = self.client.get('/api/personas/')
        self.assertEqual(limits.data['consensus_max_rounds'], CONSENSUS_MAX_ROUNDS)

    def test_stop_then_finish(self):
        created = self.create(rounds=3)
        early = self.client.post(f'/api/discussions/{created["id"]}/finish/')
        self.assertEqual(early.status_code, 400)
        self.assertEqual(early.data['code'], 'nothing_to_finish')

        discussion = Discussion.objects.get(pk=created['id'])
        engine.advance(discussion, provider_factory=lambda m: self.provider)
        self.client.post(f'/api/discussions/{created["id"]}/stop/')
        before = Message.objects.filter(discussion_id=created['id']).count()
        finish = self.client.post(f'/api/discussions/{created["id"]}/finish/')
        self.assertEqual(finish.status_code, 200)
        self.assertTrue(finish.data['finished_early'])
        self.assertTrue(finish.data['is_finished'])
        self.assertIsNone(finish.data['final_summary'])
        self.assertEqual(Message.objects.filter(discussion_id=created['id']).count(), before)

    def test_stop_discards_reply_still_being_written(self):
        created = self.create()
        url = f'/api/discussions/{created["id"]}/stop/'
        before = Message.objects.filter(discussion_id=created['id']).count()
        write = self.provider.complete
        stopped = []

        def complete(**kwargs):
            # «Зупинити» натиснули, поки модель ще пише відповідь
            if not stopped:
                stopped.append(self.client.post(url).data)
            return write(**kwargs)

        self.provider.complete = complete
        runner.run(created['id'])

        self.assertFalse(stopped[0]['is_running'])
        self.assertTrue(stopped[0]['stop_requested'])
        self.assertEqual(Message.objects.filter(discussion_id=created['id']).count(), before)
        discussion = Discussion.objects.get(pk=created['id'])
        self.assertIsNone(discussion.advance_token)
        self.assertEqual(discussion.phase, created['phase'])

    def test_note_endpoint_reopens_finished_discussion(self):
        created = self.create()
        self.client.post(f'/api/discussions/{created["id"]}/run/')
        note = self.client.post(
            f'/api/discussions/{created["id"]}/messages/',
            {'content': 'Бюджет — лише 1000 доларів.'},
            format='json',
        )
        self.assertEqual(note.status_code, 201)
        self.assertTrue(note.data['reopened'])
        detail = self.client.get(f'/api/discussions/{created["id"]}/')
        self.assertTrue(detail.data['is_finished'])
        self.assertEqual(detail.data['followups'], 1)

    def test_empty_note_rejected(self):
        created = self.create()
        response = self.client.post(
            f'/api/discussions/{created["id"]}/messages/', {'content': '  '}, format='json'
        )
        self.assertEqual(response.status_code, 400)

    @override_settings(**KEYS)
    def test_patch_changes_participant_model(self):
        created = self.create(
            personas=[
                {'slug': 'logician', 'model': 'openai:gpt-6-luna'},
                {'slug': 'skeptic'},
            ]
        )
        response = self.client.patch(
            f'/api/discussions/{created["id"]}/',
            {
                'personas': [{'slug': 'logician', 'model': 'groq:openai/gpt-oss-120b'}],
                'devil_model': 'anthropic:claude-haiku-5-5',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['personas'][0]['model'], 'groq:openai/gpt-oss-120b')
        self.assertEqual(response.data['devil_model'], 'anthropic:claude-haiku-5-5')

        bad = self.client.patch(
            f'/api/discussions/{created["id"]}/',
            {'personas': [{'slug': 'pragmatist', 'model': 'groq:openai/gpt-oss-120b'}]},
            format='json',
        )
        self.assertEqual(bad.status_code, 400)

    @override_settings(SEARCH_PROVIDER='wikipedia')
    def test_web_search_discussion_starts_with_context_check(self):
        # окремого кроку пошуку немає: спершу модератор перевіряє контекст, далі вступ
        created = self.create(web_search=True)
        self.assertEqual(created['phase'], 'clarify')
        self.assertTrue(created['search']['available'])

    @override_settings(SEARCH_PROVIDER='off')
    def test_web_search_rejected_when_disabled(self):
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто запускати власний продукт?',
                'personas': ['logician', 'skeptic'],
                'web_search': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_failed_step_exposes_public_error(self):
        created = self.create()
        with mock.patch(
            'discussions.services.engine.calls.get_provider',
            side_effect=ProviderError('401 sk-secret', status=401),
        ):
            self.client.post(f'/api/discussions/{created["id"]}/run/')
        detail = self.client.get(f'/api/discussions/{created["id"]}/')
        self.assertEqual(detail.data['status'], 'failed')
        self.assertFalse(detail.data['retryable'])
        self.assertTrue(detail.data['error_public'])
        self.assertNotIn('sk-secret', json.dumps(detail.data, ensure_ascii=False))

    def test_long_question_with_context_fits(self):
        base = 'Чи варто переходити в стартап? ' + 'Обставини: досвід, бюджет, сім’я. ' * 200
        created = self.create(question=base[:5999] + '.')
        self.assertEqual(len(created['question']), 6000)
        response = self.client.post(
            '/api/discussions/',
            {'question': 'а' * 6001, 'personas': ['logician', 'skeptic']},
            format='json',
        )
        self.assertEqual(response.status_code, 400)


class ActionPlanTests(TestCase):
    def test_final_summary_keeps_the_plan_and_triggers(self):
        summary = engine.parsing.normalize_summary(
            {
                'decision': 'Переїжджати',
                'confirmed': True,
                'next_steps': ['  Порахувати бюджет ', '', 'Подзвонити рієлтору'] + ['Крок'] * 5,
                'change_triggers': 'Якщо ціни зростуть — переглянути',
            },
            {},
            Discussion.Mode.OPEN,
            [],
        )
        self.assertEqual(summary['next_steps'][:2], ['Порахувати бюджет', 'Подзвонити рієлтору'])
        self.assertLessEqual(len(summary['next_steps']), 5)
        # модель повернула рядок замість списку — це один сигнал
        self.assertEqual(summary['change_triggers'], ['Якщо ціни зростуть — переглянути'])

    def test_final_message_shows_the_plan_instead_of_a_single_step(self):
        text = engine.texts._final_text({
            'decision': 'Переїжджати',
            'recommendation': 'Порахувати бюджет',
            'next_steps': ['Порахувати бюджет', 'Подзвонити рієлтору'],
            'change_triggers': ['Якщо оренда дорожча за 15 000 — переглянути'],
        })
        self.assertIn('1. Порахувати бюджет\n2. Подзвонити рієлтору', text)
        self.assertIn('Коли варто передумати', text)
        self.assertNotIn('Що робити далі', text)
