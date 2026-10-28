from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import (
    EMAIL_TAKEN,
    DeleteAccountSerializer,
    LoginSerializer,
    PasswordChangeSerializer,
    ProfileSerializer,
    RegisterSerializer,
    create_user,
)


def user_payload(user):
    return {
        'id': user.id,
        'name': user.name,
        'email': user.email,
        'date_joined': user.date_joined,
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

        for field in ('name', 'email'):
            if field in serializer.validated_data:
                setattr(user, field, serializer.validated_data[field])
        try:
            user.save(update_fields=['name', 'email'])
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
