from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from discussions.models import Discussion, Message
from discussions.services.criteria import compute_matrix, normalize_scores
from discussions.services.providers import ProviderError
from discussions.services.safety import looks_like_crisis, looks_like_possible_crisis

from .fakes import FakeProvider

User = get_user_model()


@override_settings(DISCUSSION_RUNNER_SYNC=True)
class ToolsTestCase(TestCase):
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
        self.user = User.objects.create_user(email='tools@test.com', name='Оксана', password='pass123!A')
        self.client.force_authenticate(self.user)

    def create(self, **extra):
        payload = {
            'question': 'Чи варто переходити на нову роботу?',
            'personas': ['logician', 'skeptic'],
            'rounds': 2,
            **extra,
        }
        response = self.client.post('/api/discussions/', payload, format='json', HTTP_ACCEPT_LANGUAGE='uk')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def run_discussion(self, discussion_id):
        self.client.post(f'/api/discussions/{discussion_id}/run/')
        return Discussion.objects.get(pk=discussion_id)


class FeedbackTests(ToolsTestCase):
    def test_helped_and_not_helped_with_a_note(self):
        created = self.create()
        url = f'/api/discussions/{created["id"]}/feedback/'
        self.assertEqual(self.client.post(url, {'value': 'helped'}, format='json').data['feedback'], 'helped')
        response = self.client.post(url, {'value': 'not_helped', 'note': 'Надто загально'}, format='json')
        self.assertEqual(response.data['feedback_note'], 'Надто загально')
        cleared = self.client.post(url, {'value': ''}, format='json')
        self.assertEqual(cleared.data['feedback'], '')
        self.assertEqual(cleared.data['feedback_note'], '')
        self.assertEqual(self.client.post(url, {'value': 'meh'}, format='json').status_code, 400)


class SafetyTests(ToolsTestCase):
    def test_crisis_words_stop_the_debate_without_calling_models(self):
        created = self.create(question='Я більше не хочу жити, чи є сенс щось вирішувати?')
        self.assertEqual(created['safety'], 'crisis')
        discussion = self.run_discussion(created['id'])
        self.assertEqual(self.provider.calls, [])
        self.assertTrue(discussion.is_finished)
        self.assertIsNone(discussion.final_summary)
        reply = discussion.messages.get(role=Message.Role.MODERATOR)
        self.assertIn('112', reply.content)

    def test_moderator_can_recognise_a_crisis_the_words_missed(self):
        self.provider.topic = 'crisis'
        discussion = self.run_discussion(self.create()['id'])
        self.assertEqual(discussion.safety, 'crisis')
        self.assertEqual(discussion.messages.filter(role=Message.Role.AI).count(), 0)
        self.assertEqual(len(self.provider.calls), 1)

    def test_sensitive_topic_keeps_the_debate_and_marks_it(self):
        self.provider.topic = 'medical'
        discussion = self.run_discussion(self.create()['id'])
        self.assertTrue(discussion.is_finished)
        self.assertEqual(discussion.safety, 'medical')
        detail = self.client.get(f'/api/discussions/{discussion.pk}/').data
        self.assertEqual(detail['safety'], 'medical')

    def test_crisis_in_a_follow_up_stops_too(self):
        discussion = self.run_discussion(self.create()['id'])
        self.client.post(
            f'/api/discussions/{discussion.pk}/messages/',
            {'content': 'Насправді я думаю про самогубство'},
            format='json',
        )
        discussion.refresh_from_db()
        self.assertEqual(discussion.safety, 'crisis')
        self.assertTrue(discussion.is_finished)

    def test_crisis_detection_is_narrow(self):
        self.assertTrue(looks_like_crisis('I want to kill myself'))
        self.assertTrue(looks_like_crisis('думаю про суїцид'))
        self.assertFalse(looks_like_crisis('Чи варто ризикнути й звільнитися?'))
        self.assertFalse(looks_like_crisis('Ця робота мене вбиває, змінювати?'))

    def test_ordinary_questions_with_crisis_words_are_not_a_crisis(self):
        for question in (
            'Не хочу жити з батьками, чи орендувати квартиру?',
            'Не хочу більше жити в Харкові — переїжджати?',
            'Will I hurt myself financially if I quit?',
            'Should I invest in a suicide-prevention startup?',
            'Чи йти волонтером у профілактику самогубств?',
            'Should I take my life savings out?',
        ):
            self.assertFalse(looks_like_crisis(question), question)
        self.assertTrue(looks_like_crisis('Я не хочу жити'))
        self.assertTrue(looks_like_crisis('Не хочу більше жити, все погано'))
        self.assertTrue(looks_like_crisis('I want to hurt myself.'))

    @override_settings(DISCUSSION_DAILY_LIMIT=1)
    def test_crisis_by_words_does_not_spend_the_daily_slot(self):
        self.create(question='Я не хочу жити')
        self.create()

    def test_not_crisis_flag_lets_the_debate_run(self):
        created = self.create(question='Я не хочу жити', not_crisis=True)
        self.assertEqual(created['safety'], '')
        discussion = self.run_discussion(created['id'])
        self.assertTrue(discussion.messages.filter(role=Message.Role.AI).exists())

    @override_settings(DISCUSSION_DAILY_LIMIT=1)
    def test_asking_about_something_else_restarts_a_crisis_stop(self):
        created = self.create(question='Я не хочу жити')
        self.run_discussion(created['id'])
        response = self.client.post(f'/api/discussions/{created["id"]}/not-crisis/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['safety'], '')
        self.assertEqual([m['role'] for m in response.data['messages']], ['user'])
        discussion = self.run_discussion(created['id'])
        self.assertTrue(discussion.is_finished)
        self.assertTrue(discussion.messages.filter(role=Message.Role.AI).exists())
        # тепер слот витрачено, і вдруге перезапустити не можна
        self.assertEqual(self.client.post('/api/discussions/', {
            'question': 'Чи варто переходити на нову роботу?', 'personas': ['logician', 'skeptic'], 'rounds': 2,
        }, format='json').status_code, 429)
        again = self.client.post(f'/api/discussions/{created["id"]}/not-crisis/')
        self.assertEqual(again.status_code, 400)


class ModeratorDownProvider(FakeProvider):
    """Модератор не відповідає на перевірку контексту — решта моделей працює."""

    def complete(self, *, system, prompt, temperature=0.7, json_mode=False):
        if '"ready"' in prompt:
            raise ProviderError('moderator is down', config=True)
        return super().complete(system=system, prompt=prompt, temperature=temperature, json_mode=json_mode)


class CrisisFallbackTests(ToolsTestCase):
    """Вузькі слова пропускають «не хочу жити і не бачу сенсу» до модератора.
    Якщо він не відповів, кризу ловить ширша ознака — а не дебати."""

    def setUp(self):
        super().setUp()
        self.provider = ModeratorDownProvider()

    def test_wide_sign_is_only_a_fallback(self):
        question = 'Я не хочу жити і не бачу сенсу'
        self.assertFalse(looks_like_crisis(question))
        self.assertTrue(looks_like_possible_crisis(question))
        self.assertFalse(looks_like_possible_crisis('Should I invest in a suicide-prevention startup?'))

    def test_crisis_is_caught_when_the_moderator_fails(self):
        created = self.create(question='Я не хочу жити і не бачу сенсу')
        self.assertEqual(created['safety'], '')
        discussion = self.run_discussion(created['id'])
        self.assertEqual(discussion.safety, 'crisis')
        self.assertFalse(discussion.messages.filter(role=Message.Role.AI).exists())

    def test_not_crisis_skips_the_wide_sign(self):
        created = self.create(question='Я не хочу жити з батьками і не бачу сенсу орендувати', not_crisis=True)
        discussion = self.run_discussion(created['id'])
        self.assertEqual(discussion.safety, '')
        self.assertTrue(discussion.messages.filter(role=Message.Role.AI).exists())

    def test_asking_about_something_else_after_a_fallback_stop(self):
        created = self.create(question='Я не хочу жити з батьками, переїжджати?')
        self.assertEqual(self.run_discussion(created['id']).safety, 'crisis')
        response = self.client.post(f'/api/discussions/{created["id"]}/not-crisis/')
        self.assertEqual(response.status_code, 200, response.data)
        discussion = self.run_discussion(created['id'])
        self.assertTrue(discussion.crisis_dismissed)
        self.assertTrue(discussion.messages.filter(role=Message.Role.AI).exists())

    def test_ordinary_question_still_runs_without_the_moderator(self):
        discussion = self.run_discussion(self.create()['id'])
        self.assertEqual(discussion.safety, '')
        self.assertTrue(discussion.messages.filter(role=Message.Role.AI).exists())


class QuickModeTests(ToolsTestCase):
    def test_one_short_answer_without_a_debate(self):
        created = self.create(quick=True)
        self.assertEqual(created['phase'], 'quick')
        discussion = self.run_discussion(created['id'])
        self.assertTrue(discussion.is_finished)
        self.assertEqual(len(self.provider.calls), 1)
        self.assertEqual(discussion.final_summary['decision'], 'Швидке рішення')
        self.assertEqual(discussion.final_summary['next_steps'], ['Зробити перший крок'])
        self.assertEqual(discussion.messages.filter(role=Message.Role.AI).count(), 0)

    def test_follow_up_gets_another_quick_answer_with_the_history(self):
        discussion = self.run_discussion(self.create(quick=True)['id'])
        self.client.post(
            f'/api/discussions/{discussion.pk}/messages/', {'content': 'А якщо зарплата та сама?'}, format='json'
        )
        discussion.refresh_from_db()
        self.assertTrue(discussion.is_finished)
        self.assertEqual(len(self.provider.calls), 2)
        self.assertIn('А якщо зарплата та сама?', self.provider.calls[-1]['prompt'])

    def test_follow_up_after_a_debate_can_ask_for_a_quick_answer(self):
        discussion = self.run_discussion(self.create()['id'])
        rounds = discussion.current_round
        self.client.post(
            f'/api/discussions/{discussion.pk}/messages/',
            {'content': 'Коротко: а якщо зарплата та сама?', 'quick': True},
            format='json',
        )
        discussion.refresh_from_db()
        self.assertTrue(discussion.is_finished)
        self.assertEqual(discussion.current_round, rounds)
        self.assertEqual(discussion.final_summary['decision'], 'Швидке рішення')
        self.assertEqual(discussion.messages.order_by('-seq').first().phase, 'quick')

    def test_web_search_can_be_switched_during_the_discussion(self):
        created = self.create()
        with mock.patch('discussions.serializers.search.is_available', return_value=True):
            response = self.client.patch(f'/api/discussions/{created["id"]}/', {'web_search': True}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(Discussion.objects.get(pk=created['id']).web_search)
        with mock.patch('discussions.serializers.search.is_available', return_value=False):
            response = self.client.patch(f'/api/discussions/{created["id"]}/', {'web_search': True}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_quick_answer_can_recognise_a_crisis(self):
        self.provider.topic = 'crisis'
        discussion = self.run_discussion(self.create(quick=True)['id'])
        self.assertEqual(discussion.safety, 'crisis')
        self.assertIsNone(discussion.final_summary)


class AskParticipantTests(ToolsTestCase):
    def test_only_the_addressed_participant_answers(self):
        discussion = self.run_discussion(self.create()['id'])
        summary = discussion.final_summary
        replies_before = discussion.messages.filter(role=Message.Role.AI).count()
        response = self.client.post(
            f'/api/discussions/{discussion.pk}/messages/',
            {'content': 'Скептику, а що, якщо компанія закриється?', 'target': 'skeptic'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['message']['reply_to_slug'], 'skeptic')
        discussion.refresh_from_db()
        self.assertTrue(discussion.is_finished)
        self.assertEqual(discussion.followups, 0)
        self.assertEqual(discussion.direct_questions, 1)
        self.assertEqual(discussion.final_summary, summary)
        new = discussion.messages.filter(role=Message.Role.AI).order_by('-seq')
        self.assertEqual(new.count(), replies_before + 1)
        self.assertEqual(new.first().persona_slug, 'skeptic')
        self.assertEqual(new.first().phase, 'answer')
        self.assertIn('компанія закриється', self.provider.calls[-1]['prompt'])

    def test_unknown_participant_or_before_the_final(self):
        created = self.create()
        early = self.client.post(
            f'/api/discussions/{created["id"]}/messages/', {'content': 'Питання', 'target': 'skeptic'}, format='json'
        )
        self.assertEqual(early.data['code'], 'bad_target')
        self.run_discussion(created['id'])
        unknown = self.client.post(
            f'/api/discussions/{created["id"]}/messages/', {'content': 'Питання', 'target': 'creative'}, format='json'
        )
        self.assertEqual(unknown.data['code'], 'bad_target')

    @override_settings(DISCUSSION_MAX_DIRECT=1)
    def test_direct_questions_have_their_own_limit(self):
        discussion = self.run_discussion(self.create()['id'])
        url = f'/api/discussions/{discussion.pk}/messages/'
        self.assertEqual(self.client.post(url, {'content': 'Раз', 'target': 'skeptic'}, format='json').status_code, 201)
        second = self.client.post(url, {'content': 'Два', 'target': 'logician'}, format='json')
        self.assertEqual(second.data['code'], 'direct_limit')


class CustomPersonaTests(ToolsTestCase):
    def make_role(self, **extra):
        response = self.client.post(
            '/api/personas/custom/',
            {'name': 'Юрист', 'description': 'Трудовий юрист із 10 роками практики, бачить ризики в договорах.', **extra},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_own_role_joins_the_discussion_and_speaks_in_character(self):
        role = self.make_role()
        personas = self.client.get('/api/personas/').data['custom']
        self.assertEqual(personas[0]['slug'], role['slug'])
        created = self.create(personas=['logician', {'slug': role['slug']}])
        self.assertEqual(created['personas'][1]['name'], 'Юрист')
        self.run_discussion(created['id'])
        systems = [call['system'] for call in self.provider.calls]
        self.assertTrue(any('бачить ризики в договорах' in system for system in systems))

    def test_role_snapshot_survives_its_deletion(self):
        role = self.make_role()
        created = self.create(personas=['logician', role['slug']])
        self.client.delete(f'/api/personas/custom/{role["id"]}/')
        discussion = self.run_discussion(created['id'])
        self.assertTrue(discussion.is_finished)
        self.assertTrue(discussion.messages.filter(persona_slug=role['slug']).exists())

    def test_someone_elses_role_is_unknown(self):
        stranger = User.objects.create_user(email='x@test.com', name='Інший', password='pass123!A')
        other = APIClient()
        other.force_authenticate(stranger)
        role = other.post(
            '/api/personas/custom/', {'name': 'Тато', 'description': 'Обережний тато, що завжди питає про запас.'},
            format='json',
        ).data
        response = self.client.post(
            '/api/discussions/',
            {'question': 'Чи варто переходити на нову роботу?', 'personas': ['logician', role['slug']]},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_vague_role_is_rejected(self):
        response = self.client.post('/api/personas/custom/', {'name': 'Х', 'description': 'юрист'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.data)
        self.assertIn('description', response.data)


class CriteriaTests(ToolsTestCase):
    CRITERIA = [{'name': 'Зарплата', 'weight': 5}, {'name': 'Близькість до сім’ї', 'weight': 3}]

    def test_participants_score_options_and_the_matrix_reaches_the_judges(self):
        self.provider.scores_reply = {
            'київ': {'зарплата': 9, 'Близькість до сім’ї': 3},
            'Львів': {'Зарплата': 5, 'Близькість до сім’ї': 9},
        }
        created = self.create(mode='choose_one', options=['Київ', 'Львів'], criteria=self.CRITERIA)
        self.assertEqual(created['criteria'], self.CRITERIA)
        discussion = self.run_discussion(created['id'])
        self.assertTrue(discussion.is_finished)
        self.assertEqual(set(discussion.scores), {'logician', 'skeptic'})
        rows = {row['option']: row for row in discussion.matrix['rows']}
        self.assertEqual(rows['Київ']['scores'], [9.0, 3.0])
        self.assertEqual(rows['Київ']['total'], 6.8)
        self.assertEqual(rows['Львів']['total'], 6.5)
        self.assertEqual(discussion.matrix['winner'], 'Київ')
        synthesis = next(call['prompt'] for call in self.provider.calls if '"supporting_arguments"' in call['prompt'])
        self.assertIn('Матриця критеріїв людини', synthesis)
        self.assertIn('Київ — Зарплата: 9.0', synthesis)

    def test_criteria_only_for_choosing_between_options(self):
        created = self.create(criteria=self.CRITERIA)
        self.assertEqual(created['criteria'], [])

    def test_criteria_are_validated(self):
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Куди переїхати?',
                'personas': ['logician', 'skeptic'],
                'mode': 'choose_one',
                'options': ['Київ', 'Львів'],
                'criteria': [{'name': 'Ціна', 'weight': 9}, {'name': 'ціна'}],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('criteria', response.data)

    def test_matrix_math_and_ties(self):
        criteria = [{'name': 'A', 'weight': 1}, {'name': 'B', 'weight': 1}]
        scores = {
            'one': normalize_scores({'scores': {'X': {'A': 8, 'B': 4}, 'Y': {'A': 4, 'B': 8}}}, ['X', 'Y'], criteria),
            'two': normalize_scores({'scores': {'X': {'A': 20}}}, ['X', 'Y'], criteria),
        }
        matrix = compute_matrix(criteria, ['X', 'Y'], scores)
        rows = {row['option']: row for row in matrix['rows']}
        # бал понад 10 обрізано до 10; порожня клітинка не тягне середнє вниз
        self.assertEqual(rows['X']['scores'], [9.0, 4.0])
        self.assertEqual(rows['Y']['scores'], [4.0, 8.0])
        self.assertEqual(matrix['winner'], 'X')
        tie = compute_matrix(criteria, ['X', 'Y'], {'one': scores['one']})
        self.assertEqual(tie['winner'], '')
