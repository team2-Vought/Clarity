"""Сторінка «Налаштування»: власні API-ключі, параметри нової дискусії, ліміти.

Ключі шифруються (accounts.secrets) і ніколи не повертаються клієнту —
лише скорочений вигляд «sk-…a1b2». Перед збереженням ключ перевіряється
безкоштовним запитом до провайдера (список моделей), щоб помилка в ключі
з'ясувалася тут, а не посеред дебатів.
"""

import logging

import httpx
from django.conf import settings
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import ProviderKey
from accounts.secrets import encrypt, mask

from .models import Discussion
from .personas import MAX_AI, MAX_ROUNDS, MIN_AI, MIN_ROUNDS
from .services import usage
from .services.catalog import (
    ANTHROPIC,
    PROVIDERS,
    USER_KEY_PROVIDERS,
    catalog,
    resolve_model,
    server_has_key,
    user_context,
)

logger = logging.getLogger(__name__)

KEY_MIN, KEY_MAX = 8, 512
VERIFY_TIMEOUT = 10

DEFAULT_PREFERENCES = {
    'default_model': '',
    'default_mode': Discussion.Mode.OPEN.value,
    'default_rounds': 2,
    'default_participants': MIN_AI,
    'web_search': True,
}


def preferences_of(user):
    """Збережені налаштування поверх значень за замовчуванням (без зайвих ключів)."""
    stored = user.preferences if isinstance(user.preferences, dict) else {}
    prefs = {key: stored.get(key, default) for key, default in DEFAULT_PREFERENCES.items()}
    # збережений колись «1 раунд» більше не доступний — піднімаємо до мінімуму
    if isinstance(prefs['default_rounds'], int):
        prefs['default_rounds'] = max(MIN_ROUNDS, prefs['default_rounds'])
    return prefs


class PreferencesSerializer(serializers.Serializer):
    default_model = serializers.CharField(required=False, allow_blank=True, max_length=120)
    default_mode = serializers.ChoiceField(
        required=False,
        choices=Discussion.Mode.choices,
        error_messages={'invalid_choice': 'Невідомий формат відповіді'},
    )
    default_rounds = serializers.IntegerField(
        required=False, min_value=MIN_ROUNDS, max_value=MAX_ROUNDS
    )
    default_participants = serializers.IntegerField(
        required=False, min_value=MIN_AI, max_value=MAX_AI
    )
    web_search = serializers.BooleanField(required=False)

    def validate_default_model(self, value):
        # модель може тимчасово стати недоступною (ключ видалено) — тоді
        # нова дискусія просто візьме іншу, тож тут перевіряємо лише каталог
        value = value.strip()
        if value and resolve_model(value) is None:
            raise serializers.ValidationError('Такої моделі немає в каталозі')
        return value


class KeySerializer(serializers.Serializer):
    key = serializers.CharField(
        max_length=KEY_MAX,
        trim_whitespace=True,
        error_messages={'blank': 'Вставте ключ', 'required': 'Вставте ключ'},
    )

    def validate_key(self, value):
        if len(value) < KEY_MIN or any(ch.isspace() for ch in value):
            raise serializers.ValidationError('Це не схоже на API-ключ')
        return value


def _verify_key(provider_id, key):
    """True — ключ працює, False — провайдер його відхилив, None — перевірити не вдалося."""
    provider = PROVIDERS[provider_id]
    base_url = provider['base_url'].rstrip('/')
    if provider['transport'] == ANTHROPIC:
        url = f'{base_url}/v1/models'
        headers = {'x-api-key': key, 'anthropic-version': '2023-06-01'}
    elif provider_id == 'openrouter':
        # список моделей OpenRouter публічний — перевіряємо сам ключ
        url = f'{base_url}/key'
        headers = {'Authorization': f'Bearer {key}'}
    else:
        url = f'{base_url}/models'
        headers = {'Authorization': f'Bearer {key}'}
    try:
        response = httpx.get(url, headers=headers, timeout=VERIFY_TIMEOUT)
    except httpx.HTTPError as exc:
        logger.info('API key check failed', extra={'provider': provider_id, 'error': str(exc)})
        return None
    if response.status_code in {400, 401, 403}:
        return False
    if response.status_code >= 400:
        return None
    return True


def _usage_payload(user):
    today = usage.today(user)
    return {
        'discussions': today.discussions,
        'discussions_limit': int(getattr(settings, 'DISCUSSION_DAILY_LIMIT', 0) or 0),
        'replies': today.replies,
        'replies_limit': int(getattr(settings, 'DISCUSSION_DAILY_ADVANCE_LIMIT', 0) or 0),
    }


def settings_payload(user):
    saved = {
        item.provider: item
        for item in ProviderKey.objects.filter(user=user, provider__in=USER_KEY_PROVIDERS)
    }
    with user_context(user):
        models = catalog()
    counts = {}
    for model in models['models']:
        counts[model['provider_id']] = counts.get(model['provider_id'], 0) + 1
    providers = []
    for item in models['providers']:
        provider_id = item['id']
        key = saved.get(provider_id)
        providers.append(
            {
                'id': provider_id,
                'label': item['label'],
                'available': item['available'],
                'models': counts.get(provider_id, 0),
                # власний ключ можна додати лише хмарним провайдерам;
                # Ollama й custom налаштовуються на сервері
                'accepts_key': provider_id in USER_KEY_PROVIDERS,
                'server_key': server_has_key(provider_id),
                'user_key': bool(key) and item['user_key'],
                'masked': key.masked if key else '',
                'updated_at': key.updated_at if key else None,
                # ключ збережено, але його вже не розшифрувати (змінився секрет)
                'unreadable': bool(key) and not item['user_key'],
            }
        )
    return {
        'preferences': preferences_of(user),
        'providers': providers,
        'models': models['models'],
        'default_model': models['default_model'],
        'usage': _usage_payload(user),
        'limits': {
            'min_ai': MIN_AI,
            'max_ai': MAX_AI,
            'min_rounds': MIN_ROUNDS,
            'max_rounds': MAX_ROUNDS,
        },
        'modes': [{'value': value, 'label': label} for value, label in Discussion.Mode.choices],
    }


class SettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(settings_payload(request.user), status=status.HTTP_200_OK)

    def patch(self, request):
        serializer = PreferencesSerializer(data=request.data.get('preferences', {}))
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.preferences = {**preferences_of(user), **serializer.validated_data}
        user.save(update_fields=['preferences'])
        return Response(settings_payload(user), status=status.HTTP_200_OK)


class ProviderKeyView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'api_keys'

    def put(self, request, provider):
        if provider not in USER_KEY_PROVIDERS:
            return Response(
                {'detail': 'Для цього провайдера власний ключ не підтримується'},
                status=status.HTTP_404_NOT_FOUND,
            )
        serializer = KeySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = serializer.validated_data['key']

        verified = _verify_key(provider, key) if settings.API_KEYS_VERIFY else None
        if verified is False:
            return Response(
                {'key': [f'{PROVIDERS[provider]["label"]} відхилив цей ключ. Перевірте, чи скопійовано його повністю.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ProviderKey.objects.update_or_create(
            user=request.user,
            provider=provider,
            defaults={'encrypted_key': encrypt(key), 'masked': mask(key)},
        )
        payload = settings_payload(request.user)
        payload['verified'] = verified
        return Response(payload, status=status.HTTP_200_OK)

    def delete(self, request, provider):
        ProviderKey.objects.filter(user=request.user, provider=provider).delete()
        return Response(settings_payload(request.user), status=status.HTTP_200_OK)
