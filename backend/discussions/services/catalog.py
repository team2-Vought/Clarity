"""Каталог безкоштовних AI-моделей для користувачів Clariti.

Моделі з free-режимом (API-кредити або ліміти) — кандидати для публічного
використання без платної підписки. Поля:
- provider: хостинг
- model: ідентификатор моделі
- access: як отримати доступ
- notes: ліміти/обмеження
"""

FREE_MODELS = [
    {
        'provider': 'Google Gemini',
        'model': 'gemini-2.0-flash',
        'access': 'Безкоштовний API-тариф у Google AI Studio',
        'notes': 'Висока швидкість, великий контекст, щоденні ліміти запитів.',
        'openai_compatible': False,
    },
    {
        'provider': 'Google Gemini',
        'model': 'gemini-2.5-flash',
        'access': 'Безкоштовний API-тариф (free tier)',
        'notes': 'Сильніша модель, ті самі безкоштовні ліміти з меншою пріоритетністю.',
        'openai_compatible': False,
    },
    {
        'provider': 'Groq',
        'model': 'llama-3.3-70b-versatile',
        'access': 'Безкоштовний API-ключ (free tier)',
        'notes': 'Дуже швидкі відповіді (LPU), ліміти на кількість токенів за хвилину.',
        'openai_compatible': True,
    },
    {
        'provider': 'Groq',
        'model': 'openai/gpt-oss-120b',
        'access': 'Безкоштовний API-ключ (free tier)',
        'notes': 'Відкрита модель від OpenAI на інфраструктурі Groq.',
        'openai_compatible': True,
    },
    {
        'provider': 'Cerebras',
        'model': 'llama-3.3-70b',
        'access': 'Безкоштовний API-ключ',
        'notes': 'Екстремальна швидкість генерації, обмежений free-ліміт.',
        'openai_compatible': True,
    },
    {
        'provider': 'OpenRouter',
        'model': 'deepseek/deepseek-chat-v3-0324:free',
        'access': 'Безкоштовні моделі з позначкою :free',
        'notes': 'Багато безкоштовних моделей в одному API; ліміти на кількість запитів.',
        'openai_compatible': True,
    },
    {
        'provider': 'OpenRouter',
        'model': 'meta-llama/llama-3.3-70b-instruct:free',
        'access': 'Безкоштовні моделі з позначкою :free',
        'notes': 'Універсальна open-source модель, підходить для дискусій.',
        'openai_compatible': True,
    },
    {
        'provider': 'DeepSeek',
        'model': 'deepseek-chat',
        'access': 'Дешеві API-кредити, безкоштовні для розробки',
        'notes': 'Сильна модель, мінімальна вартість запиту; іноді надають free-кредити.',
        'openai_compatible': True,
    },
    {
        'provider': 'Mistral',
        'model': 'mistral-small-latest',
        'access': 'Безкоштовний тариф La Plateforme',
        'notes': 'Європейська модель, free tier з обмеженим лімітом токенів.',
        'openai_compatible': True,
    },
    {
        'provider': 'Hugging Face',
        'model': 'різноманітні open-source (Llama, Qwen, Gemma)',
        'access': 'Inference API — безкоштовно з обмеженнями',
        'notes': 'Великий вибір, черги та ліміти без оплати.',
        'openai_compatible': False,
    },
    {
        'provider': 'Ollama (локально)',
        'model': 'llama3.1, qwen2.5, mistral, gemma3',
        'access': 'Безкоштовно повністю — моделі працюють на вашому комп’ютері',
        'notes': 'Потрібен комп’ютер з 8–16+ ГБ RAM; немає зовнішніх лімітів і повна приватність.',
        'openai_compatible': True,
    },
    {
        'provider': 'Together AI',
        'model': 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        'access': 'Безкоштовні кредити для нових акаунтів',
        'notes': 'Open-source моделі, free-кредити на старті.',
        'openai_compatible': True,
    },
]

RECOMMENDED_FOR_CLARITY = [
    'groq/llama-3.3-70b-versatile',
    'google/gemini-2.0-flash',
    'openrouter/deepseek-chat-v3-0324:free',
    'ollama/llama3.1',
]


def catalog():
    return {
        'models': FREE_MODELS,
        'recommended': RECOMMENDED_FOR_CLARITY,
        'note': (
            'Для дискусії з кількома персонами найкраще підходять швидкі моделі '
            '(Groq, Cerebras) або локальні через Ollama. Free-ліміти можуть змінюватися.'
        ),
    }
