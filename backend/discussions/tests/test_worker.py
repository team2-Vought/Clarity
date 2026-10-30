from concurrent.futures import Future
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from discussions.management.commands.discussion_worker import due_discussions, work
from discussions.models import Discussion

from .fakes import FakeProvider

User = get_user_model()


class InlineExecutor:
    """Виконує завдання одразу: тестова база не бачить записів з інших потоків."""

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def submit(self, fn, *args):
        future = Future()
        future.set_result(fn(*args))
        return future


@override_settings(DISCUSSION_RUNNER='worker', DISCUSSION_RUNNER_SYNC=False)
class WorkerModeTests(TestCase):
    def setUp(self):
        throttle = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request',
            return_value=True,
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
        self.user = User.objects.create_user(
            email='worker@test.com', name='Оксана', password='pass123!A'
        )
        self.client.force_authenticate(self.user)

    def create(self):
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто переїжджати до іншого міста?',
                'personas': ['logician', 'skeptic'],
                'rounds': 2,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        return Discussion.objects.get(pk=response.data['id'])

    def test_run_only_queues_the_discussion(self):
        discussion = self.create()
        with mock.patch('discussions.services.runner.threading.Thread') as thread:
            response = self.client.post(f'/api/discussions/{discussion.pk}/run/')
        self.assertEqual(response.status_code, 202)
        thread.assert_not_called()
        discussion.refresh_from_db()
        self.assertIsNotNone(discussion.run_requested_at)
        # воркер ще не взявся, але клієнт бачить, що дискусія в роботі
        self.assertTrue(response.data['is_running'])
        self.assertEqual(self.provider.calls, [])

    def test_worker_finishes_the_discussion_and_clears_the_queue(self):
        discussion = self.create()
        self.client.post(f'/api/discussions/{discussion.pk}/run/')
        with (
            mock.patch(
                'discussions.management.commands.discussion_worker.ThreadPoolExecutor',
                InlineExecutor,
            ),
            mock.patch('discussions.management.commands.discussion_worker.connection'),
        ):
            call_command('discussion_worker', once=True, poll=0, stdout=mock.Mock())
        discussion.refresh_from_db()
        self.assertTrue(discussion.is_finished)
        self.assertIsNone(discussion.run_requested_at)
        detail = self.client.get(f'/api/discussions/{discussion.pk}/')
        self.assertFalse(detail.data['is_running'])

    def test_stop_removes_the_discussion_from_the_queue(self):
        discussion = self.create()
        self.client.post(f'/api/discussions/{discussion.pk}/run/')
        stop = self.client.post(f'/api/discussions/{discussion.pk}/stop/')
        self.assertFalse(stop.data['is_running'])
        discussion.refresh_from_db()
        self.assertIsNone(discussion.run_requested_at)
        self.assertEqual(due_discussions(limit=5), [])

    def test_interrupted_step_is_resumed_after_its_lease_expires(self):
        discussion = self.create()
        self.client.post(f'/api/discussions/{discussion.pk}/run/')
        # процес упав посеред кроку: lease лишився, але давно не продовжувався
        Discussion.objects.filter(pk=discussion.pk).update(
            advance_token='00000000-0000-0000-0000-000000000001',
            advance_started_at=timezone.now(),
        )
        self.assertEqual(due_discussions(limit=5), [])
        Discussion.objects.filter(pk=discussion.pk).update(
            advance_started_at=timezone.now() - timedelta(hours=1),
        )
        [(pk, requested_at)] = due_discussions(limit=5)
        work(pk, requested_at)
        discussion.refresh_from_db()
        self.assertTrue(discussion.is_finished)

    def test_a_newer_request_keeps_the_discussion_queued(self):
        discussion = self.create()
        self.client.post(f'/api/discussions/{discussion.pk}/run/')
        [(pk, requested_at)] = due_discussions(limit=5)
        work(pk, requested_at)
        # уточнення після фіналу знову ставить дискусію в чергу
        note = self.client.post(
            f'/api/discussions/{pk}/messages/',
            {'content': 'А якщо там вища зарплата?'},
            format='json',
        )
        self.assertEqual(note.status_code, 201, note.data)
        discussion.refresh_from_db()
        self.assertIsNotNone(discussion.run_requested_at)
        self.assertFalse(discussion.is_finished)

    def test_stopping_worker_does_not_start_the_next_step(self):
        discussion = self.create()
        self.client.post(f'/api/discussions/{discussion.pk}/run/')
        [(pk, requested_at)] = due_discussions(limit=5)
        work(pk, requested_at, should_stop=lambda: True)
        discussion.refresh_from_db()
        # позначка лишається: наступний воркер продовжить
        self.assertIsNotNone(discussion.run_requested_at)
        self.assertEqual(self.provider.calls, [])


class DatabaseUrlTests(TestCase):
    def test_postgres_url_is_split_into_settings(self):
        from backend.settings import postgres_from_url

        config = postgres_from_url('postgres://clarity:p%40ss@db.example.com:5433/clarity?sslmode=require')
        self.assertEqual(config['ENGINE'], 'django.db.backends.postgresql')
        self.assertEqual(config['NAME'], 'clarity')
        self.assertEqual(config['USER'], 'clarity')
        self.assertEqual(config['PASSWORD'], 'p@ss')
        self.assertEqual(config['HOST'], 'db.example.com')
        self.assertEqual(config['PORT'], '5433')
        self.assertEqual(config['OPTIONS'], {'sslmode': 'require'})
