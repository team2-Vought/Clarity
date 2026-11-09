from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts import email_verify

User = get_user_model()

REGISTER = {
    'name': 'Тест',
    'email': 'new@test.com',
    'password': 'pass123!A',
    'confirm_password': 'pass123!A',
}


class TermsConsentTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_registration_requires_terms(self):
        response = APIClient().post('/api/auth/register/', REGISTER, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('accept_terms', response.data)

    def test_registration_rejects_declined_terms(self):
        response = APIClient().post(
            '/api/auth/register/', {**REGISTER, 'accept_terms': False}, format='json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(email='new@test.com').exists())


@override_settings(REQUIRE_EMAIL_VERIFICATION=True)
class EmailVerifyTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = APIClient()

    def register(self):
        response = self.client.post(
            '/api/auth/register/', {**REGISTER, 'accept_terms': True}, format='json'
        )
        self.assertEqual(response.status_code, 201)
        return User.objects.get(email='new@test.com')

    def test_registration_sends_link_and_blocks_discussions(self):
        user = self.register()
        self.assertFalse(user.email_verified)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('/verify-email/', mail.outbox[0].body)
        self.client.force_authenticate(user)
        me = self.client.get('/api/auth/me/')
        self.assertTrue(me.data['verification_required'])
        response = self.client.post('/api/discussions/', {'question': 'Що обрати?'}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'email_unverified')

    def test_link_verifies_email(self):
        user = self.register()
        token = email_verify.make_token(user)
        response = APIClient().post('/api/auth/email/verify/', {'token': token}, format='json')
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.email_verified)
        self.assertFalse(email_verify.blocked(user))

    def test_link_dies_after_email_change(self):
        user = self.register()
        token = email_verify.make_token(user)
        user.email = 'other@test.com'
        user.save()
        response = APIClient().post('/api/auth/email/verify/', {'token': token}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_bad_token(self):
        response = APIClient().post('/api/auth/email/verify/', {'token': 'nope'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_resend(self):
        user = self.register()
        self.client.force_authenticate(user)
        response = self.client.post('/api/auth/email/verify/resend/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 2)


class VerificationOffTests(TestCase):
    def test_not_required_by_default_in_tests(self):
        user = User.objects.create_user(email='x@test.com', name='X', password='pass123!A')
        self.assertFalse(email_verify.blocked(user))


class HealthTests(TestCase):
    def test_health(self):
        response = self.client.get('/api/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'ok': True})
