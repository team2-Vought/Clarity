"""Безпека входу: захоплення акаунта наперед, перебір пошт, блокування,
ключі пристроїв і підтвердження нової пошти."""

from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.login_limit import MAX_FAILED_ATTEMPTS
from accounts.models import AuthToken

User = get_user_model()
CSRF = {'HTTP_X_REQUESTED_WITH': 'XMLHttpRequest'}


def no_throttle(test):
    patcher = mock.patch('rest_framework.throttling.SimpleRateThrottle.allow_request', return_value=True)
    patcher.start()
    test.addCleanup(patcher.stop)


class FakeGoogleResponse:
    def __init__(self, data):
        self.status_code = 200
        self._data = data

    def json(self):
        return self._data


@override_settings(GOOGLE_CLIENT_ID='client-123.apps.googleusercontent.com')
class AccountTakeoverTests(TestCase):
    """Чужу пошту зареєстрували паролем — власниця входить через Google."""

    def setUp(self):
        no_throttle(self)

    def google_sign_in(self):
        def fake_get(url, **kwargs):
            if 'tokeninfo' in url:
                return FakeGoogleResponse({'aud': 'client-123.apps.googleusercontent.com'})
            return FakeGoogleResponse({'email': 'olena@gmail.com', 'email_verified': True, 'name': 'Олена'})

        with mock.patch('accounts.google.httpx.get', side_effect=fake_get):
            return APIClient().post('/api/auth/google/', {'access_token': 'tok'}, format='json')

    def test_google_sign_in_removes_a_password_set_by_someone_else(self):
        User.objects.create_user(email='olena@gmail.com', name='Зловмисник', password='pass123!A')
        attacker = APIClient()
        credentials = {'email': 'olena@gmail.com', 'password': 'pass123!A'}
        attacker.post('/api/auth/login/', credentials, format='json')
        self.assertEqual(attacker.get('/api/auth/me/').status_code, 200)

        response = self.google_sign_in()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['password_removed'])
        user = User.objects.get()
        self.assertTrue(user.email_verified)
        self.assertFalse(user.has_usable_password())
        # вхід зловмисника відкликано, а його пароль більше не діє
        self.assertEqual(attacker.get('/api/auth/me/').status_code, 401)
        self.assertEqual(attacker.post('/api/auth/login/', credentials, format='json').status_code, 400)

    def test_verified_account_keeps_its_password(self):
        User.objects.create_user(email='olena@gmail.com', name='Олена', password='pass123!A')
        User.objects.update(email_verified=True)
        response = self.google_sign_in()
        self.assertFalse(response.data['password_removed'])
        self.assertTrue(User.objects.get().check_password('pass123!A'))


class LoginPrivacyTests(TestCase):
    def setUp(self):
        no_throttle(self)
        User.objects.create_user(email='known@test.com', name='Тест', password='pass123!A')

    def login(self, email, password='wrong-pass1!', **extra):
        return APIClient().post(
            '/api/auth/login/', {'email': email, 'password': password}, format='json', **extra
        )

    def test_unknown_email_and_wrong_password_look_the_same(self):
        unknown = self.login('nobody@test.com')
        wrong = self.login('known@test.com')
        self.assertEqual(unknown.status_code, wrong.status_code)
        self.assertEqual(unknown.data, wrong.data)

    def test_lockout_is_per_address(self):
        for _ in range(MAX_FAILED_ATTEMPTS):
            self.login('known@test.com', REMOTE_ADDR='10.0.0.66')
        self.assertEqual(self.login('known@test.com', 'pass123!A', REMOTE_ADDR='10.0.0.66').status_code, 429)
        # власниця з іншої адреси входить як завжди
        self.assertEqual(self.login('known@test.com', 'pass123!A', REMOTE_ADDR='10.0.0.7').status_code, 200)

    def test_forwarded_for_is_ignored_without_a_proxy(self):
        for index in range(MAX_FAILED_ATTEMPTS):
            self.login('known@test.com', HTTP_X_FORWARDED_FOR=f'10.1.1.{index}')
        self.assertEqual(self.login('known@test.com', 'pass123!A').status_code, 429)


class RegisterLimitTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_registration_has_its_own_rate_limit(self):
        client = APIClient()
        codes = [
            client.post('/api/auth/register/', {
                'name': 'Тест',
                'email': f'user{index}@test.com',
                'password': 'pass123!A',
                'confirm_password': 'pass123!A',
            }, format='json').status_code
            for index in range(6)
        ]
        self.assertEqual(codes[:5], [201] * 5)
        self.assertEqual(codes[5], 429)


class DeviceTokenTests(TestCase):
    def setUp(self):
        no_throttle(self)
        User.objects.create_user(email='dev@test.com', name='Тест', password='pass123!A')

    def sign_in(self):
        client = APIClient()
        response = client.post(
            '/api/auth/login/', {'email': 'dev@test.com', 'password': 'pass123!A'}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        return client, response

    def test_key_lives_only_in_an_httponly_cookie(self):
        _, response = self.sign_in()
        self.assertNotIn('token', response.data)
        cookie = response.cookies['clarity_auth']
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['samesite'], 'Lax')
        self.assertEqual(cookie['path'], '/api/')
        # у базі — лише хеш ключа
        self.assertFalse(AuthToken.objects.filter(key_hash=cookie.value).exists())

    def test_cookie_writes_need_the_csrf_header(self):
        client, _ = self.sign_in()
        self.assertEqual(client.get('/api/auth/me/').status_code, 200)
        self.assertEqual(client.patch('/api/auth/me/', {'name': 'Нове'}, format='json').status_code, 403)
        ok = client.patch('/api/auth/me/', {'name': 'Нове'}, format='json', **CSRF)
        self.assertEqual(ok.status_code, 200)

    def test_logout_signs_out_only_this_device(self):
        phone, _ = self.sign_in()
        laptop, _ = self.sign_in()
        phone.post('/api/auth/logout/', **CSRF)
        self.assertEqual(phone.get('/api/auth/me/').status_code, 401)
        self.assertEqual(laptop.get('/api/auth/me/').status_code, 200)

    def test_key_expires(self):
        client, _ = self.sign_in()
        AuthToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(client.get('/api/auth/me/').status_code, 401)


@override_settings(FRONTEND_URL='https://clarity.test')
class EmailChangeTests(TestCase):
    def setUp(self):
        no_throttle(self)
        self.user = User.objects.create_user(email='me@test.com', name='Тест', password='pass123!A')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def request_change(self, email='new@test.com'):
        response = self.client.patch(
            '/api/auth/me/', {'email': email, 'current_password': 'pass123!A'}, format='json'
        )
        self.assertEqual(response.status_code, 200, response.data)
        letter = mail.outbox[-1]
        self.assertEqual(letter.to, [email])
        link = next(word for word in letter.body.split() if word.startswith('https://'))
        return link.rstrip('/').split('/')[-1]

    def confirm(self, token):
        return APIClient().post('/api/auth/email/confirm/', {'token': token}, format='json')

    def test_new_email_applies_only_after_the_letter(self):
        token = self.request_change()
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'me@test.com')
        response = self.confirm(token)
        self.assertEqual(response.status_code, 200, response.data)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'new@test.com')
        self.assertTrue(self.user.email_verified)

    def test_link_works_once_and_cannot_be_forged(self):
        token = self.request_change()
        self.assertEqual(self.confirm(token).status_code, 200)
        self.assertEqual(self.confirm(token).status_code, 400)
        self.assertEqual(self.confirm(token[:-2] + 'xx').status_code, 400)
