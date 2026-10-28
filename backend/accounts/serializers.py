import re

from django.db import IntegrityError
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from .login_limit import check_login_allowed, register_failed_login, reset_login_attempts
from .models import User

REQUIRED = 'Це поле обов’язкове'
NAME_TOO_SHORT = 'Занадто коротке ім’я'
NAME_TOO_LONG = 'Занадто довге ім’я'
NAME_INVALID_CHAR = 'Недопустимий символ в імені'
EMAIL_INVALID = 'Пошта вказана у неправильному форматі'
EMAIL_TAKEN = 'Користувач з такою поштою вже існує'
PASSWORD_TOO_SHORT = 'Занадто короткий пароль'
PASSWORD_INVALID_CHAR = 'Недопустимий символ у паролі'
PASSWORD_NO_LETTER = 'Пароль має містити латинські літери'
PASSWORD_NO_DIGIT = 'Додайте цифри'
PASSWORD_NO_SPECIAL = 'Додайте спец. символи'
PASSWORDS_MISMATCH = 'Паролі не збігаються'

WRONG_EMAIL = 'Неправильна пошта'
WRONG_PASSWORD = 'Невірний пароль'
PASSWORD_SAME = 'Новий пароль збігається з поточним'

NAME_MIN, NAME_MAX = 2, 40
PASSWORD_MIN = 8

EMAIL_RE = re.compile(r'[^\s@]+@[^\s@]+\.[^\s@]{2,}')
# дозволені символи пароля — друкована ASCII без пробілу
PASSWORD_RE = re.compile(r'[\x21-\x7e]+')
LETTER_RE = re.compile(r'[A-Za-z]')
DIGIT_RE = re.compile(r'[0-9]')
SPECIAL_RE = re.compile(r'[^A-Za-z0-9]')
NAME_SPECIALS = " -'’"


def clean_name(value):
    name = ' '.join(value.split())
    if len(name) < NAME_MIN:
        raise serializers.ValidationError(NAME_TOO_SHORT)
    if len(name) > NAME_MAX:
        raise serializers.ValidationError(NAME_TOO_LONG)
    if not all(ch.isalpha() or ch.isspace() or ch in NAME_SPECIALS for ch in name):
        raise serializers.ValidationError(NAME_INVALID_CHAR)
    return name


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
    """Зміна імені або пошти; нова пошта — лише з поточним паролем."""

    name = serializers.CharField(required=False, max_length=200, error_messages={'blank': REQUIRED})
    email = serializers.CharField(required=False, max_length=254, error_messages={'blank': REQUIRED})
    current_password = serializers.CharField(
        required=False, allow_blank=True, write_only=True, max_length=128
    )

    def validate_name(self, value):
        return clean_name(value)

    def validate_email(self, value):
        return clean_email(value, exclude_user=self.context['user'])

    def validate(self, attrs):
        user = self.context['user']
        if 'email' in attrs and attrs['email'] != user.email:
            password = attrs.get('current_password') or ''
            if not password:
                raise ValidationError({'current_password': REQUIRED})
            if not user.check_password(password):
                raise ValidationError({'current_password': WRONG_PASSWORD})
        return attrs


class PasswordChangeSerializer(serializers.Serializer):
    current_password = password_field()
    password = password_field()
    confirm_password = password_field()

    def validate_current_password(self, value):
        if not self.context['user'].check_password(value):
            raise serializers.ValidationError(WRONG_PASSWORD)
        return value

    def validate(self, attrs):
        check_new_password(attrs['password'], attrs['confirm_password'])
        if attrs['password'] == attrs['current_password']:
            raise ValidationError({'password': PASSWORD_SAME})
        return attrs


class DeleteAccountSerializer(serializers.Serializer):
    password = password_field()

    def validate_password(self, value):
        if not self.context['user'].check_password(value):
            raise serializers.ValidationError(WRONG_PASSWORD)
        return value
