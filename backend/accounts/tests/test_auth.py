from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.login_limit import MAX_FAILED_ATTEMPTS
from accounts.models import LoginAttempt

User = get_user_model()


class AuthApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='auth@test.com', name='Тест', password='pass123!A'
        )

    def login(self):
        response = self.client.post(
            '/api/auth/login/',
            {'email': 'auth@test.com', 'password': 'pass123!A'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        return response.data['token']

    def test_login_by_email_only(self):
        response = self.client.post(
            '/api/auth/login/',
            {'email': 'auth@test.com', 'password': 'pass123!A'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('token', response.data)

    def test_login_wrong_password(self):
        response = self.client.post(
            '/api/auth/login/',
            {'email': 'auth@test.com', 'password': 'wrong-pass1!'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('password', response.data)

    def test_me_requires_auth(self):
        response = self.client.get('/api/auth/me/')
        self.assertEqual(response.status_code, 401)

    def test_me_returns_user(self):
        token = self.login()
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token}')
        response = self.client.get('/api/auth/me/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['email'], 'auth@test.com')

    def test_logout_deletes_token(self):
        token = self.login()
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token}')
        response = self.client.post('/api/auth/logout/')
        self.assertEqual(response.status_code, 200)

        response = self.client.get('/api/auth/me/')
        self.assertEqual(response.status_code, 401)


class LoginLockoutTests(TestCase):
    def setUp(self):
        # вимикаємо DRF- throttle, щоб не заважав лічильнику спроб
        patcher = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request',
            return_value=True,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.user = User.objects.create_user(
            email='lock@test.com', name='Тест', password='pass123!A'
        )
        self.other = User.objects.create_user(
            email='other@test.com', name='Інший', password='pass123!A'
        )

    def attempt_login(self, email, password='wrong-pass1!'):
        return self.client.post(
            '/api/auth/login/',
            {'email': email, 'password': password},
            format='json',
        )

    def test_lockout_after_max_failures(self):
        for _ in range(MAX_FAILED_ATTEMPTS):
            response = self.attempt_login('lock@test.com')
            self.assertEqual(response.status_code, 400)

        # акаунт заблоковано — навіть з правильним паролем 429
        response = self.attempt_login('lock@test.com', password='pass123!A')
        self.assertEqual(response.status_code, 429)
        self.assertIn('Ліміт спроб', str(response.data))

    def test_other_account_not_affected_by_lockout(self):
        for _ in range(MAX_FAILED_ATTEMPTS):
            self.attempt_login('lock@test.com')

        # інший акаунт логіниться без обмежень
        response = self.attempt_login('other@test.com', password='pass123!A')
        self.assertEqual(response.status_code, 200)
        self.assertIn('token', response.data)

    def test_successful_login_resets_counter(self):
        for _ in range(MAX_FAILED_ATTEMPTS - 1):
            self.attempt_login('lock@test.com')

        response = self.attempt_login('lock@test.com', password='pass123!A')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(LoginAttempt.objects.filter(email='lock@test.com').exists())

        # лічильник скинуто — знову є спроби
        response = self.attempt_login('lock@test.com')
        self.assertEqual(response.status_code, 400)

    def test_unknown_email_also_counts(self):
        for _ in range(MAX_FAILED_ATTEMPTS):
            response = self.attempt_login('ghost@test.com')
            self.assertEqual(response.status_code, 400)

        response = self.attempt_login('ghost@test.com')
        self.assertEqual(response.status_code, 429)


class ProfileApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='me@test.com', name='Тест', password='pass123!A'
        )
        self.other = User.objects.create_user(
            email='taken@test.com', name='Інший', password='pass123!A'
        )
        response = self.client.post(
            '/api/auth/login/',
            {'email': 'me@test.com', 'password': 'pass123!A'},
            format='json',
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {response.data['token']}")

    def test_me_has_join_date(self):
        response = self.client.get('/api/auth/me/')
        self.assertIn('date_joined', response.data)

    def test_rename(self):
        response = self.client.patch('/api/auth/me/', {'name': '  Нове   ім’я '}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['name'], 'Нове ім’я')

    def test_rename_invalid(self):
        response = self.client.patch('/api/auth/me/', {'name': 'X'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.data)

    def test_email_change_needs_password(self):
        response = self.client.patch('/api/auth/me/', {'email': 'new@test.com'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('current_password', response.data)

        response = self.client.patch(
            '/api/auth/me/',
            {'email': 'new@test.com', 'current_password': 'wrong-pass1!'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('current_password', response.data)

    def test_email_change(self):
        response = self.client.patch(
            '/api/auth/me/',
            {'email': 'New@Test.com', 'current_password': 'pass123!A'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['email'], 'new@test.com')

    def test_email_taken(self):
        response = self.client.patch(
            '/api/auth/me/',
            {'email': 'taken@test.com', 'current_password': 'pass123!A'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.data)

    def test_password_change_rotates_token(self):
        response = self.client.post(
            '/api/auth/password/',
            {'current_password': 'pass123!A', 'password': 'newPass9!x', 'confirm_password': 'newPass9!x'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('newPass9!x'))

        # старий токен більше не діє, новий — діє
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {response.data['token']}")
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)

    def test_password_change_wrong_current(self):
        response = self.client.post(
            '/api/auth/password/',
            {'current_password': 'nope123!A', 'password': 'newPass9!x', 'confirm_password': 'newPass9!x'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('current_password', response.data)

    def test_password_change_weak(self):
        response = self.client.post(
            '/api/auth/password/',
            {'current_password': 'pass123!A', 'password': 'short', 'confirm_password': 'short'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('password', response.data)

    def test_delete_account(self):
        response = self.client.delete('/api/auth/me/', {'password': 'wrong-pass1!'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

        response = self.client.delete('/api/auth/me/', {'password': 'pass123!A'}, format='json')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.user.pk).exists())
