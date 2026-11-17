from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models

from .managers import UserManager


class User(AbstractBaseUser, PermissionsMixin):
    name = models.CharField('ім’я', max_length=40)
    email = models.EmailField('пошта', max_length=254, unique=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(auto_now_add=True)
    # аватарка — data URL квадратного зображення, стиснутого в браузері
    avatar = models.TextField('аватарка', blank=True, default='')
    # налаштування, що йдуть за акаунтом: модель і параметри нової дискусії
    preferences = models.JSONField('налаштування', default=dict, blank=True)
    # «Про мене»: вік, сім'я, гроші, цінності — щоб поради були персональними (accounts.about)
    about = models.JSONField('про мене', default=dict, blank=True)
    # пошту підтверджено: вхід через Google, посилання з листа чи відновлення пароля.
    # Реєстрація паролем її не підтверджує — хтось міг зареєструвати чужу адресу
    email_verified = models.BooleanField('пошту підтверджено', default=False)
    # гість: спробував Clarity без реєстрації (accounts.guest). Пошта службова,
    # пароля немає; реєстрація чи вхід переносять його дискусію в справжній акаунт
    is_guest = models.BooleanField('гість', default=False)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['name']

    class Meta:
        verbose_name = 'користувач'
        verbose_name_plural = 'користувачі'

    def __str__(self):
        return self.email


class LoginAttempt(models.Model):
    """Ліміт невдалих спроб входу — окремо для пари «IP + пошта»: чужі спроби
    з іншої адреси не блокують власника акаунта."""

    email = models.EmailField('пошта', max_length=254)
    ip = models.CharField('IP', max_length=64, blank=True, default='')
    failed_count = models.PositiveSmallIntegerField('невдалих спроб', default=0)
    locked_until = models.DateTimeField('заблоковано до', null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'спроба входу'
        verbose_name_plural = 'спроби входу'
        constraints = [
            models.UniqueConstraint(fields=['email', 'ip'], name='unique_login_attempt_per_ip'),
        ]

    def __str__(self):
        return f'{self.email} ({self.ip}): {self.failed_count}'


class AuthToken(models.Model):
    """Вхід на одному пристрої. Сам ключ живе лише в httpOnly-cookie браузера,
    у базі — його SHA-256: витік бази не дає увійти. «Вийти» видаляє лише цей запис."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='auth_tokens')
    key_hash = models.CharField('хеш ключа', max_length=64, unique=True)
    label = models.CharField('пристрій', max_length=200, blank=True, default='')
    created_at = models.DateTimeField('створено', auto_now_add=True)
    last_used_at = models.DateTimeField('востаннє', null=True, blank=True)
    expires_at = models.DateTimeField('діє до')

    class Meta:
        verbose_name = 'вхід'
        verbose_name_plural = 'входи'

    def __str__(self):
        return f'{self.user} — {self.label or "?"}'


class ProviderKey(models.Model):
    """Власний API-ключ користувача для LLM-провайдера (зашифрований)."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='provider_keys')
    provider = models.CharField('провайдер', max_length=32)
    encrypted_key = models.TextField('ключ (зашифрований)')
    masked = models.CharField('ключ (скорочено)', max_length=24)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'API-ключ'
        verbose_name_plural = 'API-ключі'
        constraints = [
            models.UniqueConstraint(fields=['user', 'provider'], name='unique_provider_key_per_user'),
        ]

    def __str__(self):
        return f'{self.user} — {self.provider} ({self.masked})'
