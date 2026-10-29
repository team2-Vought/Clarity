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

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['name']

    class Meta:
        verbose_name = 'користувач'
        verbose_name_plural = 'користувачі'

    def __str__(self):
        return self.email


class LoginAttempt(models.Model):
    """Ліміт невдалих спроб входу — окремо для кожного акаунта (пошти)."""

    email = models.EmailField('пошта', max_length=254, unique=True)
    failed_count = models.PositiveSmallIntegerField('невдалих спроб', default=0)
    locked_until = models.DateTimeField('заблоковано до', null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'спроба входу'
        verbose_name_plural = 'спроби входу'

    def __str__(self):
        return f'{self.email}: {self.failed_count}'


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
