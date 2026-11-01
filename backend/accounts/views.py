from django.db import IntegrityError, transaction
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from backend.i18n import L, lazy_L

from . import email_change, google, tokens
from .about import about_of
from .login_limit import reset_login_attempts
from .models import AuthToken
from .password_reset import send_reset_email, user_from_link

from .serializers import (
    EMAIL_TAKEN,
    DeleteAccountSerializer,
    LoginSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileSerializer,
    RESET_LINK_INVALID,
    RegisterSerializer,
    create_user,
    name_from_google,
)

GOOGLE_ERRORS = {
    'not_configured': (
        lazy_L('Вхід через Google не налаштовано.', 'Google sign-in is not configured.'),
        status.HTTP_503_SERVICE_UNAVAILABLE,
    ),
    'invalid': (
        lazy_L(
            'Не вдалося підтвердити вхід через Google. Спробуйте ще раз.',
            'Could not confirm the Google sign-in. Please try again.',
        ),
        status.HTTP_400_BAD_REQUEST,
    ),
    'unverified': (
        lazy_L('Пошта в Google-акаунті не підтверджена.', 'The email of the Google account is not verified.'),
        status.HTTP_400_BAD_REQUEST,
    ),
    'unavailable': (
        lazy_L('Google зараз недоступний. Спробуйте трохи пізніше.', 'Google is unavailable right now. Try again a bit later.'),
        status.HTTP_502_BAD_GATEWAY,
    ),
}


def user_payload(user):
    return {
        'id': user.id,
        'name': user.name,
        'email': user.email,
        'date_joined': user.date_joined,
        'avatar': user.avatar,
        'about': about_of(user),
        # акаунт із Google може не мати пароля — тоді профіль не питає поточний
        'has_password': user.has_usable_password(),
    }


def inactive_response():
    return Response(
        {'detail': L('Акаунт вимкнено.', 'The account is disabled.'), 'code': 'inactive'},
        status=status.HTTP_403_FORBIDDEN,
    )


def signed_in(request, user, data, code=status.HTTP_200_OK):
    """Відповідь входу: ключ пристрою — лише в httpOnly-cookie, у тілі його немає.
    Вхід іде повз django.contrib.auth.login, тож last_login оновлює tokens.issue."""
    return tokens.sign_in(Response(data, status=code), user, request)


class RegisterView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    # окремий ліміт: інакше акаунти (зокрема на чужі адреси) можна створювати потоком
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'register'

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = create_user(serializer.validated_data)
        return Response(
            {
                'detail': L('Реєстрацію успішно завершено', 'Registration completed'),
                'user': user_payload(user),
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={'ip': tokens.client_ip(request)})
        serializer.is_valid(raise_exception=True)

        user = serializer.validated_data['user']
        # вимкненому акаунту токен не видаємо: інакше кожен наступний запит дав би 401
        if not user.is_active:
            return inactive_response()
        return signed_in(request, user, {'user': user_payload(user)})


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
            return inactive_response()
        password_removed = False
        if not user.email_verified:
            # Google підтвердив, що пошта належить цій людині. Якщо акаунт створили
            # паролем без підтвердження, пароль міг задати хтось інший — скидаємо
            # його й виходимо з усіх пристроїв; власниця задасть новий у налаштуваннях
            with transaction.atomic():
                if user.has_usable_password():
                    user.set_unusable_password()
                    password_removed = True
                user.email_verified = True
                user.save(update_fields=['password', 'email_verified'])
                tokens.revoke_all(user)
        return signed_in(
            request,
            user,
            {'user': user_payload(user), 'created': created, 'password_removed': password_removed},
            status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        # лише цей пристрій: інші входи лишаються
        if isinstance(request.auth, AuthToken):
            request.auth.delete()
        return tokens.clear_cookie(Response(
            {'detail': L('Вихід виконано', 'Signed out')},
            status=status.HTTP_200_OK,
        ))


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(user_payload(request.user), status=status.HTTP_200_OK)

    def patch(self, request):
        user = request.user
        serializer = ProfileSerializer(data=request.data, context={'user': user})
        serializer.is_valid(raise_exception=True)

        changed = [field for field in ('name', 'avatar') if field in serializer.validated_data]
        for field in changed:
            setattr(user, field, serializer.validated_data[field])
        if 'about' in serializer.validated_data:
            # часткова зміна: поля, яких немає в запиті, лишаються як були
            user.about = {**about_of(user), **serializer.validated_data['about']}
            changed.append('about')
        if changed:
            user.save(update_fields=changed)
        payload = user_payload(user)
        new_email = serializer.validated_data.get('email')
        if new_email and new_email != user.email:
            # нова пошта діє лише після підтвердження з листа на неї
            if not email_change.send_confirmation(user, new_email):
                return Response(
                    {'detail': L(
                        'Не вдалося надіслати лист на нову пошту. Спробуйте пізніше.',
                        'Could not send an email to the new address. Try again later.',
                    )},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
            payload['email_pending'] = new_email
        return Response(payload, status=status.HTTP_200_OK)

    def delete(self, request):
        user = request.user
        serializer = DeleteAccountSerializer(data=request.data, context={'user': user})
        serializer.is_valid(raise_exception=True)
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EmailConfirmView(APIView):
    """POST {token} з листа — нова пошта набуває чинності. Посилання можна
    відкрити й на іншому пристрої, тож входу не потребує."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'password_reset'

    def post(self, request):
        user, new_email = email_change.read_token(str(request.data.get('token', ''))[:512])
        if user is None:
            return Response(
                {'detail': L(
                    'Посилання недійсне або застаріле. Змініть пошту в налаштуваннях ще раз.',
                    'The link is invalid or has expired. Change the email in the settings again.',
                ), 'code': 'invalid_link'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.email = new_email
        user.email_verified = True
        try:
            user.save(update_fields=['email', 'email_verified'])
        except IntegrityError:
            raise ValidationError({'email': [EMAIL_TAKEN]})
        return Response(
            {'detail': L('Пошту змінено', 'Email changed'), 'email': user.email},
            status=status.HTTP_200_OK,
        )


class PasswordView(APIView):
    """Новий пароль: інші пристрої виходять, поточний лишається."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        serializer = PasswordChangeSerializer(data=request.data, context={'user': user})
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            user.set_password(serializer.validated_data['password'])
            user.save(update_fields=['password'])
            current = request.auth if isinstance(request.auth, AuthToken) else None
            tokens.revoke_all(user, keep=current)
        return Response({'detail': L('Пароль змінено', 'Password changed')}, status=status.HTTP_200_OK)


class PasswordResetRequestView(APIView):
    """Лист із посиланням на новий пароль. Відповідь та сама, є такий акаунт чи ні."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'password_reset'

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        send_reset_email(serializer.validated_data['email'])
        return Response(
            {'detail': L(
                'Якщо акаунт із цією поштою існує, ми надіслали на неї лист із посиланням.',
                'If an account with this email exists, we have sent it a link.',
            )},
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    """GET — чи посилання ще дійсне; POST — новий пароль і вхід.

    Старі токени видаляються: пристрої, що входили зі старим паролем, вийдуть."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'password_reset'

    def get(self, request):
        valid = user_from_link(
            request.query_params.get('uid', ''), request.query_params.get('token', '')
        ) is not None
        return Response({'valid': valid}, status=status.HTTP_200_OK)

    def post(self, request):
        user = user_from_link(
            str(request.data.get('uid', ''))[:64], str(request.data.get('token', ''))[:128]
        )
        if user is None:
            # окремий код: сторінка пропонує попросити новий лист, а не виправити поле
            return Response(
                {'detail': RESET_LINK_INVALID, 'code': 'invalid_link'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            user.set_password(serializer.validated_data['password'])
            # лист дійшов — пошта справді цієї людини
            user.email_verified = True
            user.save(update_fields=['password', 'email_verified'])
            tokens.revoke_all(user)
        reset_login_attempts(user.email)
        return signed_in(
            request,
            user,
            {'detail': L('Пароль змінено', 'Password changed'), 'user': user_payload(user)},
        )
