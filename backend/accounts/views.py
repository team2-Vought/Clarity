from django.db import IntegrityError, transaction
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import google

from .serializers import (
    EMAIL_TAKEN,
    DeleteAccountSerializer,
    LoginSerializer,
    PasswordChangeSerializer,
    ProfileSerializer,
    RegisterSerializer,
    create_user,
    name_from_google,
)

GOOGLE_ERRORS = {
    'not_configured': ('Вхід через Google не налаштовано.', status.HTTP_503_SERVICE_UNAVAILABLE),
    'invalid': ('Не вдалося підтвердити вхід через Google. Спробуйте ще раз.', status.HTTP_400_BAD_REQUEST),
    'unverified': ('Пошта в Google-акаунті не підтверджена.', status.HTTP_400_BAD_REQUEST),
    'unavailable': ('Google зараз недоступний. Спробуйте трохи пізніше.', status.HTTP_502_BAD_GATEWAY),
}


def user_payload(user):
    return {
        'id': user.id,
        'name': user.name,
        'email': user.email,
        'date_joined': user.date_joined,
        'avatar': user.avatar,
        # акаунт із Google може не мати пароля — тоді профіль не питає поточний
        'has_password': user.has_usable_password(),
    }


class RegisterView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = create_user(serializer.validated_data)
        return Response(
            {
                'detail': 'Реєстрацію успішно завершено',
                'user': user_payload(user),
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = serializer.validated_data['user']
        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {
                'token': token.key,
                'user': user_payload(user),
            },
            status=status.HTTP_200_OK,
        )


class GoogleLoginView(APIView):
    """GET — чи налаштовано вхід через Google (client_id для кнопки).
    POST {access_token} — вхід в акаунт із цією поштою або реєстрація нового."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'google_login'

    def get(self, request):
        return Response({'client_id': google.client_id()}, status=status.HTTP_200_OK)

    def post(self, request):
        try:
            profile = google.verify(request.data.get('access_token'))
        except google.GoogleAuthError as exc:
            detail, code = GOOGLE_ERRORS[exc.code]
            return Response({'detail': detail, 'code': exc.code}, status=code)

        User = get_user_model()
        user = User.objects.filter(email__iexact=profile['email']).first()
        created = user is None
        if created:
            try:
                user = User.objects.create_user(
                    email=profile['email'],
                    name=name_from_google(profile['name'], profile['email']),
                    password=None,
                )
            except IntegrityError:
                # той самий акаунт щойно створив паралельний запит
                user = User.objects.get(email__iexact=profile['email'])
                created = False
        if not user.is_active:
            return Response(
                {'detail': 'Акаунт вимкнено.', 'code': 'inactive'},
                status=status.HTTP_403_FORBIDDEN,
            )
        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {'token': token.key, 'user': user_payload(user), 'created': created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(
            {'detail': 'Вихід виконано'},
            status=status.HTTP_200_OK,
        )


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(user_payload(request.user), status=status.HTTP_200_OK)

    def patch(self, request):
        user = request.user
        serializer = ProfileSerializer(data=request.data, context={'user': user})
        serializer.is_valid(raise_exception=True)

        changed = [field for field in ('name', 'email', 'avatar') if field in serializer.validated_data]
        for field in changed:
            setattr(user, field, serializer.validated_data[field])
        try:
            user.save(update_fields=changed)
        except IntegrityError:
            raise ValidationError({'email': [EMAIL_TAKEN]})
        return Response(user_payload(user), status=status.HTTP_200_OK)

    def delete(self, request):
        user = request.user
        serializer = DeleteAccountSerializer(data=request.data, context={'user': user})
        serializer.is_valid(raise_exception=True)
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordView(APIView):
    """Новий пароль і новий токен: інші пристрої, що входили зі старим, вийдуть."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        serializer = PasswordChangeSerializer(data=request.data, context={'user': user})
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            user.set_password(serializer.validated_data['password'])
            user.save(update_fields=['password'])
            Token.objects.filter(user=user).delete()
            token = Token.objects.create(user=user)
        return Response(
            {'detail': 'Пароль змінено', 'token': token.key},
            status=status.HTTP_200_OK,
        )
