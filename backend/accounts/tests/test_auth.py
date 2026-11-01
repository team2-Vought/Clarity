from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.login_limit import ANY_IP, MAX_FAILED_ATTEMPTS
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
        return response.cookies['clarity_auth'].value

    def test_login_by_email_only(self):
        response = self.client.post(
            '/api/auth/login/',
            {'email': 'auth@test.com', 'password': 'pass123!A'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('clarity_auth', response.cookies)

    def test_login_wrong_password(self):
        response = self.client.post(
            '/api/auth/login/',
            {'email': 'auth@test.com', 'password': 'wrong-pass1!'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('password', response.data)

    def test_login_sets_last_login(self):
        self.assertIsNone(self.user.last_login)
        self.login()
        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.last_login)

    def test_disabled_account_gets_no_token(self):
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        response = self.client.post(
            '/api/auth/login/',
            {'email': 'auth@test.com', 'password': 'pass123!A'},
            format='json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'inactive')
        self.assertNotIn('clarity_auth', response.cookies)

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
        self.assertIn('Забагато', str(response.data))

    def test_other_account_not_affected_by_lockout(self):
        for _ in range(MAX_FAILED_ATTEMPTS):
            self.attempt_login('lock@test.com')

        # інший акаунт логіниться без обмежень
        response = self.attempt_login('other@test.com', password='pass123!A')
        self.assertEqual(response.status_code, 200)
        self.assertIn('clarity_auth', response.cookies)

    def test_successful_login_resets_counter(self):
        for _ in range(MAX_FAILED_ATTEMPTS - 1):
            self.attempt_login('lock@test.com')

        response = self.attempt_login('lock@test.com', password='pass123!A')
        self.assertEqual(response.status_code, 200)
        # лічильник цієї адреси знято; загальна стеля пошти (ip='*') спадає з часом сама
        self.assertFalse(LoginAttempt.objects.filter(email='lock@test.com').exclude(ip=ANY_IP).exists())

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
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {response.cookies['clarity_auth'].value}")

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

    def test_avatar_set_and_remove(self):
        avatar = 'data:image/png;base64,iVBORw0KGgo='
        response = self.client.patch('/api/auth/me/', {'avatar': avatar}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['avatar'], avatar)
        self.assertEqual(response.data['name'], 'Тест')

        response = self.client.patch('/api/auth/me/', {'avatar': ''}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['avatar'], '')

    def test_avatar_invalid(self):
        for avatar in ('https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,@@'):
            response = self.client.patch('/api/auth/me/', {'avatar': avatar}, format='json')
            self.assertEqual(response.status_code, 400)
            self.assertIn('avatar', response.data)

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
        self.assertEqual(response.data['email'], 'me@test.com')
        self.assertEqual(response.data['email_pending'], 'new@test.com')

    def test_email_taken(self):
        response = self.client.patch(
            '/api/auth/me/',
            {'email': 'taken@test.com', 'current_password': 'pass123!A'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.data)

    def test_password_change_signs_out_other_devices(self):
        other = APIClient().post(
            '/api/auth/login/', {'email': 'me@test.com', 'password': 'pass123!A'}, format='json'
        ).cookies['clarity_auth'].value
        response = self.client.post(
            '/api/auth/password/',
            {'current_password': 'pass123!A', 'password': 'newPass9!x', 'confirm_password': 'newPass9!x'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('newPass9!x'))

        # цей пристрій лишається в акаунті, інший — виходить
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)
        stranger = APIClient()
        stranger.credentials(HTTP_AUTHORIZATION=f'Token {other}')
        self.assertEqual(stranger.get('/api/auth/me/').status_code, 401)

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


class FakeGoogleResponse:
    def __init__(self, status_code, data):
        self.status_code = status_code
        self._data = data

    def json(self):
        return self._data


@override_settings(GOOGLE_CLIENT_ID='client-123.apps.googleusercontent.com')
class GoogleLoginTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        patcher = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request', return_value=True
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def google(self, *, aud='client-123.apps.googleusercontent.com', email='Olena@Gmail.com',
               verified=True, name='Олена Коваль', token_status=200):
        def fake_get(url, **kwargs):
            if 'tokeninfo' in url:
                return FakeGoogleResponse(token_status, {'aud': aud})
            return FakeGoogleResponse(
                200, {'email': email, 'email_verified': verified, 'name': name}
            )

        return mock.patch('accounts.google.httpx.get', side_effect=fake_get)

    def post(self):
        return self.client.post('/api/auth/google/', {'access_token': 'tok'}, format='json')

    def test_config_exposes_client_id(self):
        response = self.client.get('/api/auth/google/')
        self.assertEqual(response.data['client_id'], 'client-123.apps.googleusercontent.com')

    def test_new_google_user_is_registered_without_password(self):
        with self.google():
            response = self.post()
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data['created'])
        self.assertIn('clarity_auth', response.cookies)
        user = User.objects.get(email='olena@gmail.com')
        self.assertEqual(user.name, 'Олена Коваль')
        self.assertFalse(user.has_usable_password())
        self.assertFalse(response.data['user']['has_password'])

    def test_existing_account_with_same_email_signs_in(self):
        existing = User.objects.create_user(email='olena@gmail.com', name='Олена', password='pass123!A')
        with self.google():
            response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['created'])
        self.assertEqual(response.data['user']['id'], existing.id)
        self.assertEqual(User.objects.count(), 1)

    def test_token_for_another_app_is_rejected(self):
        with self.google(aud='someone-else'):
            response = self.post()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'invalid')
        self.assertFalse(User.objects.exists())

    def test_invalid_token_is_rejected(self):
        with self.google(token_status=400):
            response = self.post()
        self.assertEqual(response.status_code, 400)

    def test_unverified_email_is_rejected(self):
        with self.google(verified=False):
            response = self.post()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'unverified')

    def test_name_falls_back_to_email(self):
        with self.google(name='🤖 42', email='ivan.petrenko@gmail.com'):
            self.post()
        self.assertEqual(User.objects.get().name, 'ivan petrenko')

    @override_settings(GOOGLE_CLIENT_ID='')
    def test_not_configured(self):
        self.assertEqual(self.client.get('/api/auth/google/').data['client_id'], '')
        response = self.post()
        self.assertEqual(response.status_code, 503)

    def test_passwordless_account_can_set_password_and_delete(self):
        with self.google():
            token = self.post().cookies['clarity_auth'].value
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token}')
        response = self.client.post(
            '/api/auth/password/',
            {'password': 'newPass123!', 'confirm_password': 'newPass123!'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        user = User.objects.get()
        self.assertTrue(user.check_password('newPass123!'))

        # тепер пароль є — видалення вимагає його
        self.assertEqual(self.client.delete('/api/auth/me/', {}, format='json').status_code, 400)
        response = self.client.delete('/api/auth/me/', {'password': 'newPass123!'}, format='json')
        self.assertEqual(response.status_code, 204)

    def test_passwordless_account_deletes_without_password(self):
        with self.google():
            token = self.post().cookies['clarity_auth'].value
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token}')
        response = self.client.delete('/api/auth/me/', {}, format='json')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(User.objects.exists())


@override_settings(FRONTEND_URL='https://clarity.test')
class PasswordResetTests(TestCase):
    def setUp(self):
        throttle = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request',
            return_value=True,
        )
        throttle.start()
        self.addCleanup(throttle.stop)
        self.client = APIClient()
        self.user = User.objects.create_user(
            email='reset@test.com', name='Оксана', password='pass123!A'
        )

    def request_link(self, email='reset@test.com'):
        from django.core import mail

        response = self.client.post('/api/auth/password-reset/', {'email': email}, format='json')
        self.assertEqual(response.status_code, 200)
        return mail.outbox

    def link_parts(self):
        outbox = self.request_link()
        self.assertEqual(len(outbox), 1)
        self.assertEqual(outbox[0].to, ['reset@test.com'])
        url = next(word for word in outbox[0].body.split() if word.startswith('https://'))
        self.assertTrue(url.startswith('https://clarity.test/reset-password/'))
        uid, token = url.rstrip('/').split('/')[-2:]
        return uid, token

    def confirm(self, uid, token, password='newPass1!'):
        return self.client.post(
            '/api/auth/password-reset/confirm/',
            {'uid': uid, 'token': token, 'password': password, 'confirm_password': password},
            format='json',
        )

    def test_unknown_email_gets_the_same_answer_and_no_letter(self):
        outbox = self.request_link('nobody@test.com')
        self.assertEqual(outbox, [])

    def test_link_sets_a_new_password_and_signs_in(self):
        uid, token = self.link_parts()
        check = self.client.get('/api/auth/password-reset/confirm/', {'uid': uid, 'token': token})
        self.assertTrue(check.data['valid'])
        response = self.confirm(uid, token)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn('clarity_auth', response.cookies)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('newPass1!'))

    def test_link_works_only_once(self):
        uid, token = self.link_parts()
        self.assertEqual(self.confirm(uid, token).status_code, 200)
        again = self.confirm(uid, token, password='otherPass2!')
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data['code'], 'invalid_link')

    def test_old_sessions_are_signed_out(self):
        login = self.client.post(
            '/api/auth/login/', {'email': 'reset@test.com', 'password': 'pass123!A'}, format='json'
        )
        old_token = login.cookies['clarity_auth'].value
        uid, token = self.link_parts()
        self.confirm(uid, token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {old_token}')
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)

    def test_weak_password_is_rejected_by_the_usual_rules(self):
        uid, token = self.link_parts()
        response = self.confirm(uid, token, password='short')
        self.assertEqual(response.status_code, 400)
        self.assertIn('password', response.data)

    def test_garbage_link_is_invalid(self):
        response = self.confirm('bm9wZQ', 'nope-token')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'invalid_link')
        check = self.client.get('/api/auth/password-reset/confirm/', {'uid': '!!', 'token': 'x'})
        self.assertFalse(check.data['valid'])

    def test_google_account_without_password_can_set_one(self):
        google_user = User.objects.create_user(email='g@test.com', name='Гугл', password=None)
        from django.core import mail

        self.client.post('/api/auth/password-reset/', {'email': 'G@test.com'}, format='json')
        self.assertEqual(mail.outbox[-1].to, ['g@test.com'])
        url = next(w for w in mail.outbox[-1].body.split() if w.startswith('https://'))
        uid, token = url.split('/')[-2:]
        self.assertEqual(self.confirm(uid, token).status_code, 200)
        google_user.refresh_from_db()
        self.assertTrue(google_user.has_usable_password())
