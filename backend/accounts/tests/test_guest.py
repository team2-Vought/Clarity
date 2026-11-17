from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import guest
from discussions.models import Decision, Discussion, DailyUsage
from discussions.services import usage
from discussions.tests.fakes import FakeProvider

User = get_user_model()

PAYLOAD = {'question': 'Чи варто запускати власний продукт?', 'personas': ['logician', 'skeptic']}


@override_settings(REQUIRE_EMAIL_VERIFICATION=True, GUEST_DAILY_LIMIT=5, GUEST_DISCUSSION_LIMIT=1)
class GuestModeTests(TestCase):
    def setUp(self):
        patcher = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request', return_value=True
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        provider = FakeProvider()
        provider_patcher = mock.patch(
            'discussions.services.engine.calls.get_provider', side_effect=lambda model_id: provider
        )
        provider_patcher.start()
        self.addCleanup(provider_patcher.stop)
        self.client = APIClient(HTTP_X_REQUESTED_WITH='XMLHttpRequest')

    def start_guest(self):
        response = self.client.post('/api/auth/guest/')
        self.assertEqual(response.status_code, 201)
        self.assertIn('clarity_auth', response.cookies)
        return response

    def test_guest_signs_in_and_can_start_one_discussion(self):
        data = self.start_guest().data['user']
        self.assertTrue(data['is_guest'])
        # пошти в гостя немає, тож підтвердження не вимагаємо
        self.assertFalse(data['verification_required'])
        self.assertTrue(data['email'].endswith('@' + guest.EMAIL_DOMAIN))

        first = self.client.post('/api/discussions/', PAYLOAD, format='json')
        self.assertEqual(first.status_code, 201)
        second = self.client.post('/api/discussions/', PAYLOAD, format='json')
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.data['code'], 'guest_limit')

    def test_guest_limit_is_not_daily(self):
        self.start_guest()
        user = User.objects.get(is_guest=True)
        DailyUsage.objects.create(user=user, date=timezone.localdate() - timedelta(days=1), discussions=1)
        self.assertTrue(usage.over_discussion_limit(user))
        response = self.client.post('/api/discussions/', PAYLOAD, format='json')
        self.assertEqual(response.status_code, 429)

    @override_settings(GUEST_REPLY_LIMIT=3)
    def test_guest_reply_limit_counts_all_days(self):
        self.start_guest()
        user = User.objects.get(is_guest=True)
        DailyUsage.objects.create(user=user, date=timezone.localdate() - timedelta(days=1), replies=2)
        self.assertTrue(usage.reserve_replies(user.pk, 1))
        self.assertFalse(usage.reserve_replies(user.pk, 1))

    def test_same_device_reuses_guest(self):
        self.start_guest()
        again = self.client.post('/api/auth/guest/')
        self.assertEqual(again.status_code, 200)
        self.assertEqual(User.objects.filter(is_guest=True).count(), 1)

    @override_settings(GUEST_DAILY_LIMIT=1)
    def test_daily_cap_for_whole_site(self):
        self.start_guest()
        other = APIClient(HTTP_X_REQUESTED_WITH='XMLHttpRequest')
        response = other.post('/api/auth/guest/')
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.data['code'], 'guest_cap')

    def test_guest_requires_ajax_header(self):
        self.assertEqual(APIClient().post('/api/auth/guest/').status_code, 403)

    def test_signed_in_user_stays_signed_in(self):
        User.objects.create_user(email='me@test.com', name='Я', password='Pass123!long')
        self.client.post('/api/auth/login/', {'email': 'me@test.com', 'password': 'Pass123!long'}, format='json')
        response = self.client.post('/api/auth/guest/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['user']['is_guest'])
        self.assertFalse(User.objects.filter(is_guest=True).exists())

    @override_settings(GUEST_DAILY_LIMIT=0)
    def test_guest_mode_can_be_turned_off(self):
        self.assertEqual(self.client.post('/api/auth/guest/').status_code, 503)

    def test_register_then_login_moves_guest_discussion(self):
        self.start_guest()
        created = self.client.post('/api/discussions/', PAYLOAD, format='json')
        guest_user = User.objects.get(is_guest=True)
        Decision.objects.create(
            user=guest_user, question='q', decision='d', check_at=timezone.now()
        )

        # реєстрація з того ж пристрою (cookie гостя ще в клієнті), потім вхід
        registered = self.client.post(
            '/api/auth/register/',
            {
                'name': 'Олена',
                'email': 'olena@test.com',
                'password': 'Pass123!long',
                'confirm_password': 'Pass123!long',
                'accept_terms': True,
            },
            format='json',
        )
        self.assertEqual(registered.status_code, 201)
        login = self.client.post(
            '/api/auth/login/', {'email': 'olena@test.com', 'password': 'Pass123!long'}, format='json'
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.data['adopted_discussions'], 1)

        owner = User.objects.get(email='olena@test.com')
        self.assertEqual(Discussion.objects.get(pk=created.data['id']).user, owner)
        self.assertEqual(Decision.objects.get().user, owner)
        self.assertFalse(User.objects.filter(is_guest=True).exists())
        # новий вхід — уже не гість
        me = self.client.get('/api/auth/me/')
        self.assertFalse(me.data['is_guest'])

    def test_guest_cannot_change_password_or_email(self):
        self.start_guest()
        password = self.client.post(
            '/api/auth/password/',
            {'current_password': '', 'password': 'Pass123!long', 'confirm_password': 'Pass123!long'},
            format='json',
        )
        self.assertEqual(password.status_code, 403)
        email = self.client.patch(
            '/api/auth/me/', {'email': 'x@test.com', 'current_password': ''}, format='json'
        )
        self.assertIn(email.status_code, {400, 403})
        self.assertTrue(User.objects.get(is_guest=True).email.endswith(guest.EMAIL_DOMAIN))

    @override_settings(GUEST_TTL_DAYS=7)
    def test_stale_guests_are_deleted(self):
        self.start_guest()
        user = User.objects.get(is_guest=True)
        Discussion.objects.create(user=user, question='q', personas=['logician', 'skeptic'])
        self.assertEqual(guest.delete_stale(), 0)
        self.assertEqual(guest.delete_stale(now=timezone.now() + timedelta(days=8)), 1)
        self.assertFalse(Discussion.objects.exists())

    def test_guest_gets_no_reminder_emails(self):
        from discussions.services.reminders import send_due_reminders

        self.start_guest()
        user = User.objects.get(is_guest=True)
        Decision.objects.create(
            user=user, question='q', decision='d', check_at=timezone.now() - timedelta(days=1)
        )
        self.assertEqual(send_due_reminders(), 0)
