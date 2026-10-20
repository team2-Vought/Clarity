"""Реальні LLM-провайдери Clariti.

Підтримуються два транспорти:
- OpenAI-compatible Chat Completions (OpenAI, Gemini, Groq, Cerebras, DeepSeek,
  Mistral, OpenRouter, Ollama, custom endpoint);
- Anthropic Messages API.
"""

import logging
import random
import time

import httpx
from django.conf import settings

from .catalog import ANTHROPIC, resolve_model

logger = logging.getLogger(__name__)

RETRYABLE_STATUSES = {408, 409, 425, 429, 500, 502, 503, 504}


class ProviderError(Exception):
    """Помилка виклику LLM-провайдера."""

    def __init__(self, message, *, status=None):
        super().__init__(message)
        self.status = status


def _retry_after(response):
    value = response.headers.get('Retry-After', '') if response is not None else ''
    # 429 (ліміт токенів за хвилину) зазвичай просить почекати 5–30 с:
    # коротший кап призводить до марних повторів і падіння кроку.
    cap = (
        settings.LLM_RATE_LIMIT_MAX_DELAY_SECONDS
        if response is not None and response.status_code == 429
        else settings.LLM_RETRY_MAX_DELAY_SECONDS
    )
    try:
        return max(0.0, min(float(value), cap))
    except (TypeError, ValueError):
        return None


def _post_with_retries(url, *, headers, payload, timeout, provider_label):
    attempts = max(0, int(settings.LLM_MAX_RETRIES)) + 1
    last_error = None
    for attempt in range(attempts):
        try:
            response = httpx.post(
                url,
                headers=headers,
                json=payload,
                timeout=timeout,
            )
        except httpx.HTTPError as exc:
            last_error = f'{provider_label}: помилка мережі — {exc}'
            if attempt + 1 >= attempts:
                raise ProviderError(last_error) from exc
            delay = min(
                settings.LLM_RETRY_DELAY_SECONDS * (2 ** attempt),
                settings.LLM_RETRY_MAX_DELAY_SECONDS,
            )
            logger.warning(
                'LLM request failed, retrying',
                extra={
                    'provider': provider_label,
                    'attempt': attempt + 1,
                    'delay': delay,
                    'error': str(exc),
                },
            )
            time.sleep(delay)
            continue

        if response.status_code in RETRYABLE_STATUSES and attempt + 1 < attempts:
            delay = _retry_after(response)
            if delay is None:
                delay = min(
                    settings.LLM_RETRY_DELAY_SECONDS * (2 ** attempt),
                    settings.LLM_RETRY_MAX_DELAY_SECONDS,
                )
            if response.status_code == 429:
                # паралельні виклики (вступ, відповіді на Devil) отримують
                # однаковий Retry-After — розносимо їх, щоб не зіткнутись знову
                delay += random.uniform(0, max(1.0, delay * 0.5))
            logger.warning(
                'LLM provider returned retryable status',
                extra={
                    'provider': provider_label,
                    'status': response.status_code,
                    'attempt': attempt + 1,
                    'delay': delay,
                },
            )
            time.sleep(delay)
            continue

        if response.status_code >= 400:
            detail = response.text[:400]
            hint = ''
            if response.status_code in {401, 403}:
                hint = ' Перевірте API-ключ у backend/.env.'
            raise ProviderError(
                f'{provider_label} {response.status_code}: {detail}{hint}',
                status=response.status_code,
            )
        return response

    raise ProviderError(last_error or f'{provider_label}: не вдалося отримати відповідь')


class BaseProvider:
    name = 'base'

    def complete(self, *, system, prompt, temperature=0.7, json_mode=False):
        raise NotImplementedError


class OpenAICompatibleProvider(BaseProvider):
    name = 'openai_compatible'

    def __init__(self, api_key, base_url, model, timeout, provider_label=''):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = timeout
        self.provider_label = provider_label or self.name

    def complete(self, *, system, prompt, temperature=0.7, json_mode=False):
        headers = {'Content-Type': 'application/json'}
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'
        payload = {
            'model': self.model,
            'temperature': temperature,
            'max_tokens': settings.LLM_MAX_OUTPUT_TOKENS,
            'messages': [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': prompt},
            ],
        }
        if json_mode:
            payload['response_format'] = {'type': 'json_object'}
        try:
            response = self._post(headers, payload)
        except ProviderError as exc:
            # Частина моделей не підтримує response_format — повторюємо без нього.
            if not json_mode or exc.status not in {400, 422}:
                raise
            payload = {k: v for k, v in payload.items() if k != 'response_format'}
            response = self._post(headers, payload)
        try:
            data = response.json()
        except ValueError as exc:
            raise ProviderError(
                f'{self.provider_label}: відповідь не є JSON'
            ) from exc
        try:
            content = data['choices'][0]['message']['content']
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError(
                f'{self.provider_label}: неочікуваний формат відповіді'
            ) from exc
        if isinstance(content, list):
            content = ''.join(
                part.get('text', '')
                for part in content
                if isinstance(part, dict)
            )
        if not isinstance(content, str) or not content.strip():
            raise ProviderError(f'{self.provider_label}: порожня відповідь моделі')
        return content.strip()

    def _post(self, headers, payload):
        return _post_with_retries(
            f'{self.base_url}/chat/completions',
            headers=headers,
            payload=payload,
            timeout=self.timeout,
            provider_label=f'{self.provider_label} ({self.model})',
        )


class AnthropicProvider(BaseProvider):
    name = 'anthropic'

    def __init__(self, api_key, base_url, model, timeout):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = timeout

    def complete(self, *, system, prompt, temperature=0.7, json_mode=False):
        # Anthropic не має окремого JSON-режиму: формат задає промпт.
        response = _post_with_retries(
            f'{self.base_url}/v1/messages',
            headers={
                'x-api-key': self.api_key,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
            },
            payload={
                'model': self.model,
                'temperature': temperature,
                'max_tokens': settings.LLM_MAX_OUTPUT_TOKENS,
                'system': system,
                'messages': [{'role': 'user', 'content': prompt}],
            },
            timeout=self.timeout,
            provider_label=f'Anthropic ({self.model})',
        )
        try:
            data = response.json()
        except ValueError as exc:
            raise ProviderError('Anthropic: відповідь не є JSON') from exc
        blocks = data.get('content', [])
        if not isinstance(blocks, list):
            raise ProviderError('Anthropic: неочікуваний формат відповіді')
        text = ''.join(
            block.get('text', '')
            for block in blocks
            if isinstance(block, dict) and block.get('type') == 'text'
        ).strip()
        if not text:
            raise ProviderError('Anthropic: порожня відповідь моделі')
        return text


def get_provider(model_id):
    spec = resolve_model(model_id)
    if spec is None:
        raise ProviderError(
            f'Модель «{model_id}» не знайдена в каталозі. '
            'Оновіть каталог або виберіть іншу модель.'
        )
    if not spec['available']:
        if spec['provider_id'] == 'ollama':
            raise ProviderError(
                'Ollama не налаштована: задайте OLLAMA_MODELS у backend/.env '
                'і переконайтеся, що локальний сервер запущений.'
            )
        if spec['provider_id'] == 'custom':
            raise ProviderError(
                'Custom-провайдер не налаштований: задайте CUSTOM_LLM_BASE_URL '
                'і CUSTOM_LLM_MODEL у backend/.env.'
            )
        raise ProviderError(
            f'Модель «{model_id}» недоступна: додайте {spec["key_env"]} '
            'у backend/.env і перезапустіть backend.'
        )

    if spec['transport'] == ANTHROPIC:
        return AnthropicProvider(
            api_key=spec['api_key'],
            base_url=spec['base_url'],
            model=spec['model'],
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )

    api_key = spec['api_key']
    if spec['provider_id'] == 'ollama':
        api_key = api_key or 'ollama'
    return OpenAICompatibleProvider(
        api_key=api_key,
        base_url=spec['base_url'],
        model=spec['model'],
        timeout=settings.LLM_TIMEOUT_SECONDS,
        provider_label=spec['provider'],
    )
