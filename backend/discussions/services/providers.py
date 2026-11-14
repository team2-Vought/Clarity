"""Реальні LLM-провайдери Clariti.

Підтримуються два транспорти:
- OpenAI-compatible Chat Completions (OpenAI, Gemini, Groq, Cerebras, DeepSeek,
  Mistral, OpenRouter, Ollama, custom endpoint);
- Anthropic Messages API.

Репліки учасників можна отримувати потоком (`on_text`): провайдер викликає
його з усім текстом, що вже надійшов, — так чат показує, як модель пише.
Якщо потік не вдався до кінця, запит повторюється звичайним способом
(з повторами й очікуванням rate limit), тож потік ніколи не гірший за запит.
"""

import json
import logging
import random
import time

import httpx
from django.conf import settings

from .catalog import ANTHROPIC, resolve_model

logger = logging.getLogger(__name__)

RETRYABLE_STATUSES = {408, 409, 425, 429, 500, 502, 503, 504}


# Помилки налаштування: повтор не допоможе, потрібна інша модель або ключ.
CONFIG_STATUSES = {401, 403, 404}


class ProviderError(Exception):
    """Помилка виклику LLM-провайдера.

    `config=True` — проблема налаштування (ключ, модель недоступна): повторювати
    запит марно, користувачу треба змінити модель або ключ.
    """

    def __init__(self, message, *, status=None, config=False, quota=False):
        super().__init__(message)
        self.status = status
        self.quota = quota
        self.config = config or quota or status in CONFIG_STATUSES


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


QUOTA_MARKERS = (
    'insufficient_quota',
    'exceeded your current quota',
    'quota exceeded',
    'credit balance',
    'resource_exhausted',
)
DAILY_MARKERS = ('per day', 'perday', 'daily')
MINUTE_MARKERS = ('per minute', 'perminute', 'per second', '(tpm)', '(rpm)')


def _quota_exhausted(response):
    """429 через вичерпану квоту чи денний ліміт, а не хвилинний rate limit.

    Хвилинні ліміти (TPM/RPM) минають за секунди — їх варто повторити;
    денні ліміти й порожній баланс — ні.
    """
    text = (response.text or '')[:2000].casefold()
    if any(marker in text for marker in DAILY_MARKERS):
        return True
    if any(marker in text for marker in MINUTE_MARKERS):
        return False
    return any(marker in text for marker in QUOTA_MARKERS)


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

        if response.status_code == 429 and _quota_exhausted(response):
            # денна/місячна квота не відновиться за секунди — повтори марні
            raise ProviderError(
                f'{provider_label} 429: квоту вичерпано — {response.text[:300]}',
                status=429,
                config=True,
                quota=True,
            )

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
                hint = ' Перевірте API-ключ у налаштуваннях або в backend/.env.'
            raise ProviderError(
                f'{provider_label} {response.status_code}: {detail}{hint}',
                status=response.status_code,
            )
        return response

    raise ProviderError(last_error or f'{provider_label}: не вдалося отримати відповідь')


def _stream_events(url, *, headers, payload, timeout, provider_label):
    """Дані подій SSE (рядки після `data:`). Помилку HTTP кидає одразу — без
    повторів: їх зробить звичайний запит, на який перейде виклик."""
    # read — пауза між шматками потоку: модель, що замовкла посеред відповіді,
    # не має тримати крок до загального таймауту
    stream_timeout = httpx.Timeout(timeout, read=min(timeout, settings.LLM_STALL_SECONDS))
    with httpx.stream('POST', url, headers=headers, json=payload, timeout=stream_timeout) as response:
        if response.status_code >= 400:
            response.read()
            quota = response.status_code == 429 and _quota_exhausted(response)
            raise ProviderError(
                f'{provider_label} {response.status_code}: {response.text[:400]}',
                status=response.status_code,
                quota=quota,
            )
        for line in response.iter_lines():
            if line.startswith('data:'):
                yield line[5:].strip()


def _event(data, provider_label):
    try:
        return json.loads(data)
    except ValueError as exc:
        raise ProviderError(f'{provider_label}: пошкоджена подія потоку') from exc


class BaseProvider:
    name = 'base'
    # Чи вміє провайдер віддавати текст потоком (`on_text` у complete)
    supports_streaming = False

    def complete(self, *, system, prompt, temperature=0.7, json_mode=False, on_text=None):
        raise NotImplementedError

    def _complete_streaming(self, stream, fallback, on_text):
        """Потік із переходом на звичайний запит: збій мережі чи 5xx посеред
        відповіді не мають ламати крок, а помилки ключа чи квоти — повторюватись."""
        try:
            text = ''
            for chunk in stream():
                if chunk:
                    text += chunk
                    on_text(text)
            if text.strip():
                return text.strip()
            raise ProviderError(f'{self.provider_label}: порожня відповідь моделі')
        except (ProviderError, httpx.HTTPError) as exc:
            if getattr(exc, 'config', False):
                raise
            logger.warning(
                'LLM stream failed, falling back to a plain request',
                extra={'provider': self.provider_label, 'error': str(exc)},
            )
            # чернетку з обірваного потоку не лишаємо — текст прийде заново
            on_text('')
            return fallback()


class OpenAICompatibleProvider(BaseProvider):
    name = 'openai_compatible'
    supports_streaming = True

    def __init__(self, api_key, base_url, model, timeout, provider_label=''):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = timeout
        self.provider_label = provider_label or self.name

    def complete(self, *, system, prompt, temperature=0.7, json_mode=False, on_text=None):
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
        elif on_text is not None:
            return self._complete_streaming(
                lambda: self._stream(headers, payload),
                lambda: self._complete_plain(headers, payload, json_mode),
                on_text,
            )
        return self._complete_plain(headers, payload, json_mode)

    def _stream(self, headers, payload):
        label = f'{self.provider_label} ({self.model})'
        for data in _stream_events(
            f'{self.base_url}/chat/completions',
            headers=headers,
            payload={**payload, 'stream': True},
            timeout=self.timeout,
            provider_label=label,
        ):
            if data == '[DONE]':
                return
            event = _event(data, label)
            if isinstance(event, dict) and event.get('error'):
                raise ProviderError(f'{label}: {str(event["error"])[:400]}')
            choices = event.get('choices') if isinstance(event, dict) else None
            if not choices:
                # службові події (usage тощо) тексту не мають
                continue
            delta = (choices[0] or {}).get('delta') or {}
            content = delta.get('content')
            if isinstance(content, str):
                yield content

    def complete_image(self, *, system, prompt, image, mime):
        """Відповідь на зображення (base64) — для фото документів."""
        headers = {'Content-Type': 'application/json'}
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'
        payload = {
            'model': self.model,
            'temperature': 0,
            'max_tokens': settings.LLM_MAX_OUTPUT_TOKENS * 2,
            'messages': [
                {'role': 'system', 'content': system},
                {
                    'role': 'user',
                    'content': [
                        {'type': 'text', 'text': prompt},
                        {'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{image}'}},
                    ],
                },
            ],
        }
        return self._complete_plain(headers, payload, False)

    def _complete_plain(self, headers, payload, json_mode):
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
    supports_streaming = True

    def __init__(self, api_key, base_url, model, timeout):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = timeout
        self.provider_label = f'Anthropic ({model})'

    def _request(self, system, prompt, temperature):
        headers = {
            'x-api-key': self.api_key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        }
        payload = {
            'model': self.model,
            'temperature': temperature,
            'max_tokens': settings.LLM_MAX_OUTPUT_TOKENS,
            'system': system,
            'messages': [{'role': 'user', 'content': prompt}],
        }
        return headers, payload

    def complete_image(self, *, system, prompt, image, mime):
        """Відповідь на зображення (base64) — для фото документів."""
        headers, payload = self._request(system, prompt, 0)
        payload['max_tokens'] = settings.LLM_MAX_OUTPUT_TOKENS * 2
        payload['messages'] = [
            {
                'role': 'user',
                'content': [
                    {'type': 'image', 'source': {'type': 'base64', 'media_type': mime, 'data': image}},
                    {'type': 'text', 'text': prompt},
                ],
            }
        ]
        return self._complete_plain(headers, payload)

    def complete(self, *, system, prompt, temperature=0.7, json_mode=False, on_text=None):
        # Anthropic не має окремого JSON-режиму: формат задає промпт.
        headers, payload = self._request(system, prompt, temperature)
        if on_text is not None and not json_mode:
            return self._complete_streaming(
                lambda: self._stream(headers, payload),
                lambda: self._complete_plain(headers, payload),
                on_text,
            )
        return self._complete_plain(headers, payload)

    def _stream(self, headers, payload):
        for data in _stream_events(
            f'{self.base_url}/v1/messages',
            headers=headers,
            payload={**payload, 'stream': True},
            timeout=self.timeout,
            provider_label=self.provider_label,
        ):
            event = _event(data, self.provider_label)
            kind = event.get('type') if isinstance(event, dict) else None
            if kind == 'error':
                raise ProviderError(f'{self.provider_label}: {str(event.get("error"))[:400]}')
            if kind == 'message_stop':
                return
            delta = event.get('delta') if kind == 'content_block_delta' else None
            if isinstance(delta, dict) and delta.get('type') == 'text_delta':
                yield delta.get('text') or ''

    def _complete_plain(self, headers, payload):
        response = _post_with_retries(
            f'{self.base_url}/v1/messages',
            headers=headers,
            payload=payload,
            timeout=self.timeout,
            provider_label=self.provider_label,
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
            'Оновіть каталог або виберіть іншу модель.',
            config=True,
        )
    if not spec['available']:
        if spec['provider_id'] == 'ollama':
            raise ProviderError(
                'Ollama не налаштована: задайте OLLAMA_MODELS у backend/.env '
                'і переконайтеся, що локальний сервер запущений.',
                config=True,
            )
        if spec['provider_id'] == 'custom':
            raise ProviderError(
                'Custom-провайдер не налаштований: задайте CUSTOM_LLM_BASE_URL '
                'і CUSTOM_LLM_MODEL у backend/.env.',
                config=True,
            )
        raise ProviderError(
            f'Модель «{model_id}» недоступна: додайте власний ключ {spec["provider"]} '
            f'у налаштуваннях або {spec["key_env"]} у backend/.env.',
            config=True,
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
