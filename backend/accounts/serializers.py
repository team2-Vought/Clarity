import base64
import binascii
import re

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from backend.i18n import L, lazy_L

from .about import AboutSerializer
from .login_limit import check_login_allowed, register_failed_login, reset_login_attempts
from .models import User

REQUIRED = lazy_L('Це поле обов’язкове', 'This field is required')
NAME_TOO_SHORT = lazy_L('Занадто коротке ім’я', 'The name is too short')
NAME_TOO_LONG = lazy_L('Занадто довге ім’я', 'The name is too long')
NAME_INVALID_CHAR = lazy_L('Недопустимий символ в імені', 'Invalid character in the name')
EMAIL_INVALID = lazy_L('Пошта вказана у неправильному форматі', 'The email address is not in a valid format')
TERMS_REQUIRED = lazy_L(
    'Щоб створити акаунт, погодьтеся з Умовами та Політикою конфіденційності',
    'To create an account, accept the Terms and the Privacy Policy',
)
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
# вхід каже, що саме не так: реєстрація однаково розкриває зайняту пошту
# (EMAIL_TAKEN), а підбір пароля стримує ліміт спроб (login_limit)
NO_ACCOUNT = lazy_L(
    'Акаунта з такою поштою немає. Перевірте адресу або зареєструйтеся',
    'There is no account with this email. Check the address or sign up',
)
LOGIN_WRONG_PASSWORD = lazy_L(
    'Неправильний пароль. Спробуйте ще раз або відновіть його',
    'Wrong password. Try again or reset it',
)
GOOGLE_ONLY = lazy_L(
    'Цей акаунт входить через Google: натисніть «Продовжити з Google» або задайте пароль через відновлення',
    'This account signs in with Google: use “Continue with Google” or set a password via reset',
)
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


def check_new_password(password, confirm_password, user=None):
    """Ті самі правила, що й при реєстрації; помилка — словник {поле: текст}.

    Після наших правил — валідатори AUTH_PASSWORD_VALIDATORS: поширені паролі
    («Password1!») і схожі на ім'я чи пошту не проходять."""
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
    try:
        validate_password(password, user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({'password': list(exc.messages)})


def check_current_password(user, password, ip, field='current_password'):
    """Поточний пароль перед зміною пошти, пароля чи видаленням акаунта.

    Невдачі рахує той самий лічильник, що й вхід (login_limit): інакше з чужим
    відкритим сеансом пароль можна було б перебирати тут без обмежень."""
    if not password:
        raise ValidationError({field: REQUIRED})
    check_login_allowed(ip, user.email)
    if not user.check_password(password):
        register_failed_login(ip, user.email)
        raise ValidationError({field: WRONG_PASSWORD})


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
    # згода з Умовами й Політикою конфіденційності — явна позначка у формі
    accept_terms = serializers.BooleanField(
        required=True,
        error_messages={'required': TERMS_REQUIRED, 'invalid': TERMS_REQUIRED},
    )

    def validate_name(self, value):
        return clean_name(value)

    def validate_email(self, value):
        return clean_email(value)

    def validate_accept_terms(self, value):
        if value is not True:
            raise serializers.ValidationError(TERMS_REQUIRED)
        return value

    def validate(self, attrs):
        check_new_password(
            attrs['password'],
            attrs['confirm_password'],
            User(email=attrs['email'], name=attrs['name']),
        )
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
        ip = self.context.get('ip', '')

        # 429, якщо з цієї адреси вичерпано спроби для цього акаунта
        check_login_allowed(ip, email)

        user = User.objects.filter(email=email).first()
        if user is None:
            # хешуємо пароль і для невідомої пошти: інакше її видавав би час відповіді
            User().set_password(password)
        if user is None:
            register_failed_login(ip, email)
            raise ValidationError({'email': NO_ACCOUNT})
        if not user.has_usable_password():
            register_failed_login(ip, email)
            raise ValidationError({'password': GOOGLE_ONLY})
        if not user.check_password(password):
            register_failed_login(ip, email)
            raise ValidationError({'password': LOGIN_WRONG_PASSWORD})

        reset_login_attempts(email, ip=ip)
        attrs['user'] = user
        return attrs


class ProfileSerializer(serializers.Serializer):
    """Зміна імені, пошти, аватарки чи «Про мене»; нова пошта — лише з поточним паролем."""

    name = serializers.CharField(required=False, max_length=200, error_messages={'blank': REQUIRED})
    email = serializers.CharField(required=False, max_length=254, error_messages={'blank': REQUIRED})
    avatar = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False, max_length=500_000)
    current_password = serializers.CharField(
        required=False, allow_blank=True, write_only=True, max_length=128
    )
    about = AboutSerializer(required=False)

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
            check_current_password(user, attrs.get('current_password') or '', self.context.get('ip', ''))
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
            check_current_password(user, current, self.context.get('ip', ''))
        check_new_password(attrs['password'], attrs['confirm_password'], user)
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
            check_current_password(
                user, attrs.get('password') or '', self.context.get('ip', ''), field='password'
            )
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
        check_new_password(attrs['password'], attrs['confirm_password'], self.context.get('user'))
        return attrs
