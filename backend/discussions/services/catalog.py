"""Каталог реальних LLM-моделей, які підтримує Clariti.

Кожен запис має унікальний id у форматі ``provider:model``. Каталог не містить
заглушок: якщо моделі немає в цьому списку, її не можна вибрати в дискусії.
Доступність залежить від наявності API-ключа або локального налаштування.
"""

from django.conf import settings

OPENAI_COMPATIBLE = 'openai_compatible'
ANTHROPIC = 'anthropic'

PROVIDERS = {
    'openai': {
        'label': 'OpenAI',
        'transport': OPENAI_COMPATIBLE,
        'base_url': 'https://api.openai.com/v1',
        'key_setting': 'LLM_OPENAI_API_KEY',
        'key_env': 'OPENAI_API_KEY',
        'requires_key': True,
    },
    'anthropic': {
        'label': 'Anthropic',
        'transport': ANTHROPIC,
        'base_url': 'https://api.anthropic.com',
        'key_setting': 'LLM_ANTHROPIC_API_KEY',
        'key_env': 'ANTHROPIC_API_KEY',
        'requires_key': True,
    },
    'gemini': {
        'label': 'Google Gemini',
        'transport': OPENAI_COMPATIBLE,
        'base_url': 'https://generativelanguage.googleapis.com/v1beta/openai',
        'key_setting': 'LLM_GEMINI_API_KEY',
        'key_env': 'GEMINI_API_KEY',
        'requires_key': True,
    },
    'groq': {
        'label': 'Groq',
        'transport': OPENAI_COMPATIBLE,
        'base_url': 'https://api.groq.com/openai/v1',
        'key_setting': 'LLM_GROQ_API_KEY',
        'key_env': 'GROQ_API_KEY',
        'requires_key': True,
    },
    'cerebras': {
        'label': 'Cerebras',
        'transport': OPENAI_COMPATIBLE,
        'base_url': 'https://api.cerebras.ai/v1',
        'key_setting': 'LLM_CEREBRAS_API_KEY',
        'key_env': 'CEREBRAS_API_KEY',
        'requires_key': True,
    },
    'deepseek': {
        'label': 'DeepSeek',
        'transport': OPENAI_COMPATIBLE,
        'base_url': 'https://api.deepseek.com/v1',
        'key_setting': 'LLM_DEEPSEEK_API_KEY',
        'key_env': 'DEEPSEEK_API_KEY',
        'requires_key': True,
    },
    'mistral': {
        'label': 'Mistral',
        'transport': OPENAI_COMPATIBLE,
        'base_url': 'https://api.mistral.ai/v1',
        'key_setting': 'LLM_MISTRAL_API_KEY',
        'key_env': 'MISTRAL_API_KEY',
        'requires_key': True,
    },
    'openrouter': {
        'label': 'OpenRouter',
        'transport': OPENAI_COMPATIBLE,
        'base_url': 'https://openrouter.ai/api/v1',
        'key_setting': 'LLM_OPENROUTER_API_KEY',
        'key_env': 'OPENROUTER_API_KEY',
        'requires_key': True,
    },
    'ollama': {
        'label': 'Ollama (локально)',
        'transport': OPENAI_COMPATIBLE,
        'base_url_setting': 'LLM_OLLAMA_BASE_URL',
        'requires_key': False,
    },
    'custom': {
        'label': 'Custom OpenAI-compatible',
        'transport': OPENAI_COMPATIBLE,
        'base_url_setting': 'LLM_CUSTOM_BASE_URL',
        'key_setting': 'LLM_CUSTOM_API_KEY',
        'requires_key': False,
    },
}

MODELS = [
    {
        'provider_id': 'openai',
        'model': 'gpt-6-luna',
        'label': 'GPT-6 Luna',
        'notes': 'Найекономніша актуальна модель OpenAI для частих викликів.',
    },
    {
        'provider_id': 'openai',
        'model': 'gpt-6-sol',
        'label': 'GPT-6 Sol',
        'notes': 'Сильна модель OpenAI для складних міркувань.',
    },
    {
        'provider_id': 'anthropic',
        'model': 'claude-sonnet-5-5',
        'label': 'Claude Sonnet 5.5',
        'notes': 'Баланс швидкості та якості для дебатів.',
    },
    {
        'provider_id': 'anthropic',
        'model': 'claude-haiku-5-5',
        'label': 'Claude Haiku 5.5',
        'notes': 'Швидка й дешева модель для великої кількості реплік.',
    },
    {
        'provider_id': 'anthropic',
        'model': 'claude-opus-5-5',
        'label': 'Claude Opus 5.5',
        'notes': 'Найсильніша актуальна модель Anthropic для складних рішень.',
    },
    {
        'provider_id': 'gemini',
        'model': 'gemini-3.8-flash',
        'label': 'Gemini 3.8 Flash',
        'notes': 'Швидка модель Gemini з великим контекстом.',
    },
    {
        'provider_id': 'gemini',
        'model': 'gemini-3.5-flash-lite',
        'label': 'Gemini 3.5 Flash-Lite',
        'notes': 'Найдешевша актуальна модель Gemini.',
    },
    {
        'provider_id': 'groq',
        'model': 'openai/gpt-oss-120b',
        'label': 'GPT-OSS 120B',
        'notes': 'Потужна відкрита модель на дуже швидкій інфраструктурі Groq.',
    },
    {
        'provider_id': 'groq',
        'model': 'openai/gpt-oss-20b',
        'label': 'GPT-OSS 20B',
        'notes': 'Швидка й дешева модель Groq.',
    },
    {
        'provider_id': 'groq',
        'model': 'qwen/qwen3.8-27b',
        'label': 'Qwen 3.8 27B',
        'notes': 'Швидка мультимодальна модель Qwen на Groq.',
    },
    {
        'provider_id': 'cerebras',
        'model': 'gpt-oss-120b',
        'label': 'GPT-OSS 120B',
        'notes': 'Відкрита модель на екстремально швидкій інфраструктурі Cerebras.',
    },
    {
        'provider_id': 'deepseek',
        'model': 'deepseek-flash',
        'label': 'DeepSeek V4.1 Flash',
        'notes': 'Актуальна швидка модель DeepSeek з великим контекстом.',
    },
    {
        'provider_id': 'deepseek',
        'model': 'deepseek-v4-pro',
        'label': 'DeepSeek V4 Pro',
        'notes': 'Сильніша модель DeepSeek для складних міркувань.',
    },
    {
        'provider_id': 'mistral',
        'model': 'mistral-large-4',
        'label': 'Mistral Large 4',
        'notes': 'Флагманська відкрита модель Mistral.',
    },
    {
        'provider_id': 'mistral',
        'model': 'mistral-medium-3-5',
        'label': 'Mistral Medium 3.5',
        'notes': 'Збалансована модель Mistral.',
    },
    {
        'provider_id': 'mistral',
        'model': 'mistral-small-2603',
        'label': 'Mistral Small 4',
        'notes': 'Швидка й дешева модель Mistral.',
    },
    {
        'provider_id': 'openrouter',
        'model': 'openrouter/auto',
        'label': 'OpenRouter Auto',
        'notes': 'OpenRouter автоматично обирає доступну модель під запит.',
    },
    {
        'provider_id': 'openrouter',
        'model': 'openai/gpt-6-luna',
        'label': 'GPT-6 Luna',
        'notes': 'Модель OpenAI через OpenRouter.',
    },
    {
        'provider_id': 'openrouter',
        'model': 'anthropic/claude-sonnet-5-5',
        'label': 'Claude Sonnet 5.5',
        'notes': 'Модель Anthropic через OpenRouter.',
    },
]

RECOMMENDED = [
    'openai:gpt-6-luna',
    'gemini:gemini-3.8-flash',
    'groq:openai/gpt-oss-120b',
    'anthropic:claude-haiku-5-5',
]


def _settings_list(name):
    value = getattr(settings, name, [])
    if isinstance(value, str):
        return [item.strip() for item in value.split(',') if item.strip()]
    return [str(item).strip() for item in value if str(item).strip()]


def _base_models():
    for item in MODELS:
        spec = dict(item)
        spec['id'] = f"{spec['provider_id']}:{spec['model']}"
        yield spec


def _dynamic_models():
    for model in _settings_list('LLM_OLLAMA_MODELS'):
        yield {
            'id': f'ollama:{model}',
            'provider_id': 'ollama',
            'model': model,
            'label': model,
            'notes': 'Локальна модель через Ollama; ключ не потрібен.',
        }
    custom_model = getattr(settings, 'LLM_CUSTOM_MODEL', '').strip()
    custom_base_url = getattr(settings, 'LLM_CUSTOM_BASE_URL', '').strip()
    if custom_model and custom_base_url:
        yield {
            'id': f'custom:{custom_model}',
            'provider_id': 'custom',
            'model': custom_model,
            'label': getattr(settings, 'LLM_CUSTOM_LABEL', '') or custom_model,
            'notes': 'Власний OpenAI-сумісний endpoint із налаштувань.',
        }


def _provider_key(provider_id):
    provider = PROVIDERS[provider_id]
    key_setting = provider.get('key_setting')
    if not key_setting:
        return ''
    return getattr(settings, key_setting, '') or ''


def _base_url(provider_id):
    provider = PROVIDERS[provider_id]
    if provider_id == 'ollama':
        return getattr(settings, 'LLM_OLLAMA_BASE_URL', 'http://localhost:11434/v1').rstrip('/')
    if provider_id == 'custom':
        return getattr(settings, 'LLM_CUSTOM_BASE_URL', '').rstrip('/')
    return provider['base_url'].rstrip('/')


def _is_available(spec):
    provider = PROVIDERS[spec['provider_id']]
    if spec['provider_id'] == 'ollama':
        return bool(_base_url('ollama'))
    if spec['provider_id'] == 'custom':
        return bool(_base_url('custom') and spec['model'])
    if provider['requires_key']:
        return bool(_provider_key(spec['provider_id']))
    return bool(_base_url(spec['provider_id']))


def _all_specs():
    for item in _base_models():
        yield item
    for item in _dynamic_models():
        yield item


def _public_spec(spec):
    provider = PROVIDERS[spec['provider_id']]
    available = _is_available(spec)
    return {
        'id': spec['id'],
        'provider_id': spec['provider_id'],
        'provider': provider['label'],
        'model': spec['model'],
        'label': spec['label'],
        'notes': spec.get('notes', ''),
        'available': available,
        'requires_key': provider['requires_key'],
        'key_env': provider.get('key_env', ''),
        'local': spec['provider_id'] in {'ollama', 'custom'},
    }


def resolve_model(model_id):
    if not model_id:
        model_id = getattr(settings, 'LLM_DEFAULT_MODEL', '')
    for spec in _all_specs():
        if spec['id'] == model_id:
            resolved = dict(spec)
            resolved['base_url'] = _base_url(spec['provider_id'])
            resolved['api_key'] = _provider_key(spec['provider_id'])
            resolved['transport'] = PROVIDERS[spec['provider_id']]['transport']
            resolved['requires_key'] = PROVIDERS[spec['provider_id']]['requires_key']
            resolved['key_env'] = PROVIDERS[spec['provider_id']].get('key_env', '')
            resolved['available'] = _is_available(spec)
            resolved['provider'] = PROVIDERS[spec['provider_id']]['label']
            return resolved
    return None


def default_model_id():
    configured = getattr(settings, 'LLM_DEFAULT_MODEL', '')
    specs = list(_all_specs())
    if configured and any(
        spec['id'] == configured and _is_available(spec) for spec in specs
    ):
        return configured
    for spec in specs:
        if _is_available(spec):
            return spec['id']
    return ''


def catalog():
    models = [_public_spec(spec) for spec in _all_specs()]
    models.sort(key=lambda item: (not item['available'], item['provider'], item['label']))
    available_ids = {item['id'] for item in models if item['available']}
    recommended = [model_id for model_id in RECOMMENDED if model_id in available_ids]
    providers = []
    for provider_id, provider in PROVIDERS.items():
        if provider_id == 'custom':
            available = bool(_base_url('custom') and getattr(settings, 'LLM_CUSTOM_MODEL', '').strip())
        elif provider_id == 'ollama':
            available = bool(_base_url('ollama') and _settings_list('LLM_OLLAMA_MODELS'))
        else:
            available = bool(_provider_key(provider_id))
        providers.append(
            {
                'id': provider_id,
                'label': provider['label'],
                'available': available,
                'requires_key': provider['requires_key'],
                'key_env': provider.get('key_env', ''),
            }
        )
    return {
        'models': models,
        'providers': providers,
        'recommended': recommended,
        'default_model': default_model_id(),
        'note': (
            'Показано лише реальні моделі. Для віддалених моделей додайте API-ключ '
            'у backend/.env; Ollama працює локально без ключа. Після зміни .env '
            'перезапустіть backend.'
        ),
    }


def model_label(model_id):
    """Людська назва моделі для повідомлень користувачу."""
    spec = resolve_model(model_id) if model_id else None
    if spec is None:
        return model_id or 'модель'
    return f"{spec['provider']} — {spec['label']}"


def available_model_ids():
    """Доступні моделі: спершу рекомендовані, потім решта в порядку каталогу."""
    available = [spec['id'] for spec in _all_specs() if _is_available(spec)]
    preferred = [model_id for model_id in RECOMMENDED if model_id in available]
    return preferred + [model_id for model_id in available if model_id not in preferred]
