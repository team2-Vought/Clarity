"""Реальні LLM-провайдери Clariti.

Підтримуються два транспорти:
- OpenAI-compatible Chat Completions (OpenAI, Gemini, Groq, Cerebras, DeepSeek,
  Mistral, OpenRouter, Ollama, custom endpoint);
- Anthropic Messages API.
"""

import httpx
from django.conf import settings

from .catalog import ANTHROPIC, resolve_model


class ProviderError(Exception):
    """Помилка виклику LLM-провайдера."""


class BaseProvider:
    name = 'base'

    def complete(self, *, system, prompt, temperature=0.7):
        raise NotImplementedError


class OpenAICompatibleProvider(BaseProvider):
    name = 'openai_compatible'

    def __init__(self, api_key, base_url, model, timeout, provider_label=''):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = timeout
        self.provider_label = provider_label or self.name

    def complete(self, *, system, prompt, temperature=0.7):
        headers = {'Content-Type': 'application/json'}
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'
        try:
            response = httpx.post(
                f'{self.base_url}/chat/completions',
                headers=headers,
                json={
                    'model': self.model,
                    'temperature': temperature,
                    'messages': [
                        {'role': 'system', 'content': system},
                        {'role': 'user', 'content': prompt},
                    ],
                },
                timeout=self.timeout,
            )
        except httpx.HTTPError as exc:
            raise ProviderError(
                f'{self.provider_label}: помилка мережі — {exc}'
            ) from exc
        if response.status_code >= 400:
            detail = response.text[:400]
            hint = ''
            if response.status_code in {401, 403}:
                hint = ' Перевірте API-ключ у backend/.env.'
            raise ProviderError(
                f'{self.provider_label} ({self.model}) {response.status_code}: {detail}{hint}'
            )
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


class AnthropicProvider(BaseProvider):
    name = 'anthropic'

    def __init__(self, api_key, base_url, model, timeout):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = timeout

    def complete(self, *, system, prompt, temperature=0.7):
        try:
            response = httpx.post(
                f'{self.base_url}/v1/messages',
                headers={
                    'x-api-key': self.api_key,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': self.model,
                    'max_tokens': 2048,
                    'system': system,
                    'messages': [{'role': 'user', 'content': prompt}],
                },
                timeout=self.timeout,
            )
        except httpx.HTTPError as exc:
            raise ProviderError(f'Anthropic: помилка мережі — {exc}') from exc
        if response.status_code >= 400:
            hint = ''
            if response.status_code in {401, 403}:
                hint = ' Перевірте ANTHROPIC_API_KEY у backend/.env.'
            raise ProviderError(
                f'Anthropic ({self.model}) {response.status_code}: '
                f'{response.text[:400]}{hint}'
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
