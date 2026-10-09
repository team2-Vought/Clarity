import re

from django.db import IntegrityError
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from .models import User

REQUIRED = 'Це поле обов’язкове'
NAME_TOO_SHORT = 'Занадто коротке ім’я'
NAME_TOO_LONG = 'Занадто довге ім’я'
NAME_INVALID_CHAR = 'Недопустимий символ в імені'
EMAIL_INVALID = 'Пошта вказана у неправильному форматі'
EMAIL_TAKEN = 'Користувач з такою поштою вже існує'
PASSWORD_TOO_SHORT = 'Занадто короткий пароль'
PASSWORD_INVALID_CHAR = 'Недопустимий символ у паролі'
PASSWORDS_MISMATCH = 'Паролі не збігаються'

NAME_MIN, NAME_MAX = 2, 40
PASSWORD_MIN = 8

EMAIL_RE = re.compile(r'[^\s@]+@[^\s@]+\.[^\s@]{2,}')
# дозволені символи пароля — друкована ASCII без пробілу
PASSWORD_RE = re.compile(r'[\x21-\x7e]+')
NAME_SPECIALS = " -'’"


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
        name = ' '.join(value.split())
        if len(name) < NAME_MIN:
            raise serializers.ValidationError(NAME_TOO_SHORT)
        if len(name) > NAME_MAX:
            raise serializers.ValidationError(NAME_TOO_LONG)
        if not all(ch.isalpha() or ch.isspace() or ch in NAME_SPECIALS for ch in name):
            raise serializers.ValidationError(NAME_INVALID_CHAR)
        return name

    def validate_email(self, value):
        email = value.strip()
        if not EMAIL_RE.fullmatch(email):
            raise serializers.ValidationError(EMAIL_INVALID)
        email = email.lower()
        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError(EMAIL_TAKEN)
        return email

    def validate(self, attrs):
        password = attrs['password']
        confirm_password = attrs['confirm_password']

        if password != confirm_password:
            raise serializers.ValidationError(
                {'confirm_password': PASSWORDS_MISMATCH}
            )
        if len(password) < PASSWORD_MIN:
            raise serializers.ValidationError({'password': PASSWORD_TOO_SHORT})
        if not PASSWORD_RE.fullmatch(password):
            raise serializers.ValidationError({'password': PASSWORD_INVALID_CHAR})
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
