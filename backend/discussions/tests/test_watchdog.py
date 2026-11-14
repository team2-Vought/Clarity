"""Сторож виклику моделі: загальний дедлайн, «Замінити модель», повна чернетка."""

import threading
import time
import uuid

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from discussions.models import Discussion
from discussions.serializers import DiscussionSerializer
from discussions.services import engine
from discussions.services.engine import calls
from discussions.services.engine.base import EngineError, StepPlan

User = get_user_model()


class WatchedCallTests(SimpleTestCase):
    def test_returns_result_and_relays_text_in_caller_thread(self):
        caller = threading.get_ident()
        seen = []

        def call(relay):
            relay('Пер')
            relay('Перший')
            return 'Перший'

        def on_text(text):
            seen.append((text, threading.get_ident() == caller))

        result = calls._watched(call, on_text=on_text, deadline=5, cancelled=None)
        self.assertEqual(result, 'Перший')
        self.assertTrue(seen)
        self.assertEqual(seen[-1], ('Перший', True))

    def test_silent_model_is_abandoned_after_deadline(self):
        release = threading.Event()
        started = time.monotonic()
        with self.assertRaises(calls._Abandoned) as caught:
            calls._watched(lambda relay: release.wait(5), on_text=None, deadline=0.3, cancelled=None)
        release.set()
        self.assertEqual(caught.exception.reason, 'timeout')
        self.assertLess(time.monotonic() - started, 2)

    def test_swap_request_abandons_the_call(self):
        release = threading.Event()
        calls.CANCEL_CHECK_SECONDS, saved = 0, calls.CANCEL_CHECK_SECONDS
        try:
            with self.assertRaises(calls._Abandoned) as caught:
                calls._watched(
                    lambda relay: release.wait(5),
                    on_text=None,
                    deadline=10,
                    cancelled=lambda: 'swap',
                )
        finally:
            calls.CANCEL_CHECK_SECONDS = saved
            release.set()
        self.assertEqual(caught.exception.reason, 'swap')

    def test_provider_errors_reach_the_caller(self):
        def call(relay):
            raise ValueError('boom')

        with self.assertRaises(ValueError):
            calls._watched(call, on_text=None, deadline=5, cancelled=None)


class SlowProvider:
    def __init__(self, delay, text):
        self.delay = delay
        self.text = text

    def complete(self, *, system, prompt, temperature=0.7, json_mode=False):
        time.sleep(self.delay)
        return self.text


@override_settings(LLM_WATCHDOG=True, LLM_CALL_DEADLINE_SECONDS=0.3)
class PersonaDeadlineTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='w@test.com', name='W', password='pass123!A')
        self.discussion = Discussion.objects.create(
            user=self.user, question='Rust чи Go?', personas=['logician', 'emotional']
        )

    def plan(self, **extra):
        return StepPlan(
            phase=Discussion.Phase.OPENING,
            role='ai',
            persona={'slug': 'emotional', 'name': 'Емпат'},
            model_id='slow:model',
            system='s',
            prompt='p',
            temperature=0.5,
            **extra,
        )

    def factory(self, model_id):
        if model_id == 'slow:model':
            return SlowProvider(3, 'запізно')
        return SlowProvider(0, 'Вчасна відповідь')

    def test_model_past_deadline_is_replaced_by_fallback(self):
        plan = self.plan(fallback_models=['fast:model'])
        # запасна модель «за рахунок людини» — без ліміту
        with _own_keys():
            started = time.monotonic()
            raw = calls._complete_persona(plan, self.factory, self.discussion, None)
        self.assertEqual(raw, 'Вчасна відповідь')
        self.assertEqual(plan.used_model, 'fast:model')
        self.assertLess(time.monotonic() - started, 2.5)

    def test_without_fallback_the_step_fails_with_a_clear_timeout(self):
        plan = self.plan()
        with self.assertRaises(EngineError) as caught:
            calls._complete_persona(plan, self.factory, self.discussion, None)
        self.assertEqual(caught.exception.code, 'provider_timeout')
        self.assertTrue(caught.exception.retryable)


class _own_keys:
    """Запасні моделі в тесті не зараховуються в денний ліміт."""

    def __enter__(self):
        self.saved = calls.paid_by_user
        calls.paid_by_user = lambda model_id: True
        return self

    def __exit__(self, *exc):
        calls.paid_by_user = self.saved


class DraftBoardTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='d@test.com', name='D', password='pass123!A')
        self.token = uuid.uuid4()
        self.discussion = Discussion.objects.create(
            user=self.user,
            question='Rust чи Go?',
            personas=['logician', 'emotional'],
            advance_token=self.token,
            advance_started_at=timezone.now(),
            live_token=self.token,
        )
        self.board = engine.live._DraftBoard(self.discussion.pk, self.token)
        self.plan = StepPlan(
            phase=Discussion.Phase.OPENING,
            role='ai',
            persona={'slug': 'skeptic', 'name': 'Скептик'},
            model_id='groq:a',
            system='s',
            prompt='p',
            temperature=0.5,
        )

    def drafts(self):
        self.discussion.refresh_from_db()
        return self.discussion.live_drafts

    def test_finished_reply_is_written_in_full_despite_flush_interval(self):
        self.board.attempt(self.plan, 'groq:a')
        self.board.update(self.plan, 'Перше.')
        # наступний шматок приходить швидше за інтервал запису
        self.board.update(self.plan, 'Перше. Третє, у стартапу немає')
        self.board.finish(self.plan, 'Перше. Третє, у стартапу немає планів на ці мови.')
        [draft] = self.drafts()
        self.assertEqual(draft['text'], 'Перше. Третє, у стартапу немає планів на ці мови.')
        self.assertTrue(draft['done'])
        self.assertEqual(draft['model'], 'groq:a')

    def test_new_attempt_marks_the_switch(self):
        self.board.attempt(self.plan, 'groq:a')
        self.board.attempt(self.plan, 'groq:b')
        [draft] = self.drafts()
        self.assertTrue(draft['swapped'])
        self.assertEqual(draft['model'], 'groq:b')
        self.assertEqual(draft['text'], '')

    def test_cancel_check_sees_swap_and_stop(self):
        check = self.board.cancel_check('skeptic')
        self.assertEqual(check(), '')
        Discussion.objects.filter(pk=self.discussion.pk).update(live_swaps={'skeptic': 1})
        self.assertEqual(check(), 'swap')
        Discussion.objects.filter(pk=self.discussion.pk).update(advance_token=None)
        self.assertEqual(check(), 'stopped')

    def test_waiting_participants_show_in_live_with_elapsed(self):
        self.board.attempt(self.plan, 'groq:a')
        live = DiscussionSerializer(Discussion.objects.get(pk=self.discussion.pk)).data['live']
        [draft] = live['drafts']
        self.assertEqual(draft['slug'], 'skeptic')
        self.assertEqual(draft['text'], '')
        self.assertIn('elapsed', draft)
        self.assertNotIn('started', draft)
        self.assertGreater(live['slow_after'], 0)

    def test_opening_status_names_the_state_not_the_question(self):
        self.board.attempt(self.plan, 'groq:a')
        thinking = {item['slug']: item['text'] for item in engine.describe_step(
            Discussion.objects.get(pk=self.discussion.pk)
        )}
        self.assertNotIn('Rust чи Go?', ''.join(thinking.values()))
        self.board.finish(self.plan, 'Готово.')
        thinking = {item['slug'] for item in engine.describe_step(
            Discussion.objects.get(pk=self.discussion.pk)
        )}
        # готовий учасник уже не «думає»
        self.assertNotIn('skeptic', thinking)


class SwapEndpointTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email='s@test.com', name='S', password='pass123!A')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        token = uuid.uuid4()
        self.discussion = Discussion.objects.create(
            user=self.user,
            question='Rust чи Go?',
            personas=['logician', 'emotional'],
            advance_token=token,
            advance_started_at=timezone.now(),
            live_token=token,
            live_drafts=[
                {'slug': 'emotional', 'name': 'Емпат', 'text': '', 'done': False},
                {'slug': 'logician', 'name': 'Логік', 'text': 'Готово', 'done': True},
            ],
        )
        self.url = f'/api/discussions/{self.discussion.pk}/swap-model/'

    def test_swap_is_recorded_for_a_writing_participant(self):
        response = self.client.post(self.url, {'slug': 'emotional'}, format='json')
        self.assertEqual(response.status_code, 202)
        self.client.post(self.url, {'slug': 'emotional'}, format='json')
        self.discussion.refresh_from_db()
        self.assertEqual(self.discussion.live_swaps, {'emotional': 2})

    def test_finished_or_unknown_participant_cannot_be_swapped(self):
        for slug in ('logician', 'nobody'):
            response = self.client.post(self.url, {'slug': slug}, format='json')
            self.assertEqual(response.status_code, 409)

    def test_only_owner_can_swap(self):
        other = User.objects.create_user(email='o@test.com', name='O', password='pass123!A')
        client = APIClient()
        client.force_authenticate(other)
        response = client.post(self.url, {'slug': 'emotional'}, format='json')
        self.assertEqual(response.status_code, 404)
