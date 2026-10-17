from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

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
            {'name': 'Тест', 'email': 'auth@test.com', 'password': 'pass123!A'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        return response.data['token']

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
