import base64
import binascii
import re

from django.db import IntegrityError
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from backend.i18n import L, lazy_L

from .login_limit import check_login_allowed, register_failed_login, reset_login_attempts
from .models import User

REQUIRED = lazy_L('Це поле обов’язкове', 'This field is required')
NAME_TOO_SHORT = lazy_L('Занадто коротке ім’я', 'The name is too short')
NAME_TOO_LONG = lazy_L('Занадто довге ім’я', 'The name is too long')
NAME_INVALID_CHAR = lazy_L('Недопустимий символ в імені', 'Invalid character in the name')
EMAIL_INVALID = lazy_L('Пошта вказана у неправильному форматі', 'The email address is not in a valid format')
EMAIL_TAKEN = lazy_L('Користувач з такою поштою вже існує', 'A user with this email already exists')
PASSWORD_TOO_SHORT = lazy_L('Занадто короткий пароль', 'The password is too short')
PASSWORD_INVALID_CHAR = lazy_L('Недопустимий символ у паролі', 'Invalid character in the password')
PASSWORD_NO_LETTER = lazy_L('Пароль має містити латинські літери', 'The password must contain Latin letters')
PASSWORD_NO_DIGIT = lazy_L('Додайте цифри', 'Add digits')
PASSWORD_NO_SPECIAL = lazy_L('Додайте спец. символи', 'Add special characters')
PASSWORDS_MISMATCH = lazy_L('Паролі не збігаються', 'The passwords do not match')
AVATAR_INVALID = lazy_L('Не вдалося прочитати зображення', 'Could not read the image')
AVATAR_TOO_LARGE = lazy_L('Зображення завелике', 'The image is too large')

RESET_LINK_INVALID = lazy_L(
    'Посилання недійсне або застаріле. Попросіть новий лист.',
    'The link is invalid or has expired. Request a new email.',
)
WRONG_EMAIL = lazy_L('Неправильна пошта', 'Wrong email')
WRONG_PASSWORD = lazy_L('Невірний пароль', 'Wrong password')
PASSWORD_SAME = lazy_L('Новий пароль збігається з поточним', 'The new password is the same as the current one')

NAME_MIN, NAME_MAX = 2, 40
PASSWORD_MIN = 8
# 256×256 у WebP/JPEG важить десятки КБ; запас — для PNG
AVATAR_MAX_BYTES = 300 * 1024

EMAIL_RE = re.compile(r'[^\s@]+@[^\s@]+\.[^\s@]{2,}')
# дозволені символи пароля — друкована ASCII без пробілу
PASSWORD_RE = re.compile(r'[\x21-\x7e]+')
LETTER_RE = re.compile(r'[A-Za-z]')
DIGIT_RE = re.compile(r'[0-9]')
SPECIAL_RE = re.compile(r'[^A-Za-z0-9]')
NAME_SPECIALS = " -'’"
AVATAR_RE = re.compile(r'data:image/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)')


def clean_name(value):
    name = ' '.join(value.split())
    if len(name) < NAME_MIN:
        raise serializers.ValidationError(NAME_TOO_SHORT)
    if len(name) > NAME_MAX:
        raise serializers.ValidationError(NAME_TOO_LONG)
    if not all(ch.isalpha() or ch.isspace() or ch in NAME_SPECIALS for ch in name):
        raise serializers.ValidationError(NAME_INVALID_CHAR)
    return name


def name_from_google(name, email):
    """Ім'я з профілю Google за нашими правилами; інакше — з пошти або «Користувач»."""
    for candidate in (name, email.split('@')[0].replace('.', ' ').replace('_', ' ')):
        kept = ''.join(ch for ch in candidate if ch.isalpha() or ch in NAME_SPECIALS)
        kept = ' '.join(kept.split())[:NAME_MAX].strip()
        if len(kept) >= NAME_MIN:
            return kept
    return L('Користувач', 'User')


def clean_email(value, exclude_user=None):
    email = value.strip()
    if not EMAIL_RE.fullmatch(email):
        raise serializers.ValidationError(EMAIL_INVALID)
    email = email.lower()
    taken = User.objects.filter(email=email)
    if exclude_user is not None:
        taken = taken.exclude(pk=exclude_user.pk)
    if taken.exists():
        raise serializers.ValidationError(EMAIL_TAKEN)
    return email


def clean_avatar(value):
    """Порожній рядок — прибрати аватарку; інакше data URL PNG/JPEG/WebP."""
    if not value:
        return ''
    match = AVATAR_RE.fullmatch(value)
    if not match:
        raise serializers.ValidationError(AVATAR_INVALID)
    try:
        data = base64.b64decode(match.group(1), validate=True)
    except (binascii.Error, ValueError):
        raise serializers.ValidationError(AVATAR_INVALID)
    if len(data) > AVATAR_MAX_BYTES:
        raise serializers.ValidationError(AVATAR_TOO_LARGE)
    return value


def check_new_password(password, confirm_password):
    """Ті самі правила, що й при реєстрації; помилка — словник {поле: текст}."""
    if password != confirm_password:
        raise serializers.ValidationError({'confirm_password': PASSWORDS_MISMATCH})
    if len(password) < PASSWORD_MIN:
        raise serializers.ValidationError({'password': PASSWORD_TOO_SHORT})
    if not PASSWORD_RE.fullmatch(password):
        raise serializers.ValidationError({'password': PASSWORD_INVALID_CHAR})
    if not LETTER_RE.search(password):
        raise serializers.ValidationError({'password': PASSWORD_NO_LETTER})
    if not DIGIT_RE.search(password):
        raise serializers.ValidationError({'password': PASSWORD_NO_DIGIT})
    if not SPECIAL_RE.search(password):
        raise serializers.ValidationError({'password': PASSWORD_NO_SPECIAL})


def password_field():
    return serializers.CharField(
        required=True,
        allow_blank=False,
        write_only=True,
        max_length=128,
        error_messages={'required': REQUIRED, 'blank': REQUIRED},
    )


class RegisterSerializer(serializers.Serializer):
    name = serializers.CharField(
        required=True,
        allow_blank=False,
        max_length=200,
        error_messages={'required': REQUIRED, 'blank': REQUIRED},
    )
    email = serializers.CharField(
        required=True,
        allow_blank=False,
        max_length=254,
        error_messages={'required': REQUIRED, 'blank': REQUIRED},
    )
    password = serializers.CharField(
        required=True,
        allow_blank=False,
        write_only=True,
        max_length=128,
        error_messages={'required': REQUIRED, 'blank': REQUIRED},
    )
    confirm_password = serializers.CharField(
        required=True,
        allow_blank=False,
        write_only=True,
        max_length=128,
        error_messages={'required': REQUIRED, 'blank': REQUIRED},
    )

    def validate_name(self, value):
        return clean_name(value)

    def validate_email(self, value):
        return clean_email(value)

    def validate(self, attrs):
        check_new_password(attrs['password'], attrs['confirm_password'])
        return attrs


def create_user(validated_data):
    try:
        return User.objects.create_user(
            email=validated_data['email'],
            name=validated_data['name'],
            password=validated_data['password'],
        )
    except IntegrityError:
        raise ValidationError({'email': [EMAIL_TAKEN]})


class LoginSerializer(serializers.Serializer):
    email = serializers.CharField(
        required=True,
        allow_blank=False,
        max_length=254,
        error_messages={'required': REQUIRED, 'blank': REQUIRED},
    )
    password = serializers.CharField(
        required=True,
        allow_blank=False,
        write_only=True,
        max_length=128,
        error_messages={'required': REQUIRED, 'blank': REQUIRED},
    )

    def validate(self, attrs):
        email = attrs['email'].strip().lower()
        password = attrs['password']

        # 429, якщо для цього акаунта вичерпано спроби (інші акаунти не блокуються)
        check_login_allowed(email)

        user = User.objects.filter(email=email).first()
        if user is None:
            register_failed_login(email)
            raise ValidationError({'email': WRONG_EMAIL})
        if not user.check_password(password):
            register_failed_login(email)
            raise ValidationError({'password': WRONG_PASSWORD})

        reset_login_attempts(email)
        attrs['user'] = user
        return attrs


class ProfileSerializer(serializers.Serializer):
    """Зміна імені, пошти чи аватарки; нова пошта — лише з поточним паролем."""

    name = serializers.CharField(required=False, max_length=200, error_messages={'blank': REQUIRED})
    email = serializers.CharField(required=False, max_length=254, error_messages={'blank': REQUIRED})
    avatar = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False, max_length=500_000)
    current_password = serializers.CharField(
        required=False, allow_blank=True, write_only=True, max_length=128
    )

    def validate_name(self, value):
        return clean_name(value)

    def validate_email(self, value):
        return clean_email(value, exclude_user=self.context['user'])

    def validate_avatar(self, value):
        return clean_avatar(value)

    def validate(self, attrs):
        user = self.context['user']
        # акаунт, створений через Google, пароля не має — нічого підтверджувати
        if 'email' in attrs and attrs['email'] != user.email and user.has_usable_password():
            password = attrs.get('current_password') or ''
            if not password:
                raise ValidationError({'current_password': REQUIRED})
            if not user.check_password(password):
                raise ValidationError({'current_password': WRONG_PASSWORD})
        return attrs


class PasswordChangeSerializer(serializers.Serializer):
    """Зміна пароля; акаунт із Google без пароля задає перший пароль без поточного."""

    current_password = serializers.CharField(
        required=False, allow_blank=True, write_only=True, max_length=128
    )
    password = password_field()
    confirm_password = password_field()

    def validate(self, attrs):
        user = self.context['user']
        current = attrs.get('current_password') or ''
        if user.has_usable_password():
            if not current:
                raise ValidationError({'current_password': REQUIRED})
            if not user.check_password(current):
                raise ValidationError({'current_password': WRONG_PASSWORD})
        check_new_password(attrs['password'], attrs['confirm_password'])
        if current and attrs['password'] == current:
            raise ValidationError({'password': PASSWORD_SAME})
        return attrs


class DeleteAccountSerializer(serializers.Serializer):
    """Видалення з паролем; акаунт із Google без пароля — без підтвердження паролем."""

    password = serializers.CharField(
        required=False, allow_blank=True, write_only=True, max_length=128
    )

    def validate(self, attrs):
        user = self.context['user']
        if user.has_usable_password():
            password = attrs.get('password') or ''
            if not password:
                raise ValidationError({'password': REQUIRED})
            if not user.check_password(password):
                raise ValidationError({'password': WRONG_PASSWORD})
        return attrs


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.CharField(
        required=True,
        allow_blank=False,
        max_length=254,
        error_messages={'required': REQUIRED, 'blank': REQUIRED},
    )

    def validate_email(self, value):
        email = value.strip().lower()
        if not EMAIL_RE.fullmatch(email):
            raise serializers.ValidationError(EMAIL_INVALID)
        return email


class PasswordResetConfirmSerializer(serializers.Serializer):
    """Новий пароль за посиланням з листа; правила ті самі, що й при реєстрації."""

    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)
    password = password_field()
    confirm_password = password_field()

    def validate(self, attrs):
        check_new_password(attrs['password'], attrs['confirm_password'])
        return attrs
