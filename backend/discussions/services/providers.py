"""Абстракція LLM-провайдера.

Два режими:
- mock — без ключів, детерміновані відповіді для розробки та тестів;
- openai_compatible — будь-який endpoint у форматі OpenAI Chat Completions
  (OpenAI, OpenRouter, Groq, Cerebras, DeepSeek, локальний Ollama тощо).
"""

import json

import httpx
from django.conf import settings


class ProviderError(Exception):
    """Помилка виклику LLM-провайдера."""


class BaseProvider:
    name = 'base'

    def complete(self, *, system, prompt, temperature=0.7):
        raise NotImplementedError


class MockProvider(BaseProvider):
    """Детерміновані шаблонні відповіді — робота без мережі та ключів."""

    name = 'mock'

    def complete(self, *, system, prompt, temperature=0.7):
        marker = _find_marker(prompt)
        persona = _find_persona(prompt)
        if marker == 'json_synthesis':
            return json.dumps(_mock_synthesis(prompt), ensure_ascii=False)
        if marker == 'json_devil':
            return json.dumps(_mock_devil(prompt), ensure_ascii=False)
        if marker == 'json_final':
            return json.dumps(_mock_final(prompt), ensure_ascii=False)
        if marker == 'opening':
            return _mock_opening(persona, prompt)
        if marker == 'debate':
            return _mock_debate(persona, prompt)
        return f'[{persona}] Коротка думка за темою запитання.'


class OpenAICompatibleProvider(BaseProvider):
    name = 'openai_compatible'

    def __init__(self, api_key, base_url, model, timeout):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = timeout

    def complete(self, *, system, prompt, temperature=0.7):
        if not self.api_key:
            raise ProviderError('OPENAI_API_KEY не задано')
        try:
            response = httpx.post(
                f'{self.base_url}/chat/completions',
                headers={'Authorization': f'Bearer {self.api_key}'},
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
            raise ProviderError(f'Помилка мережі: {exc}') from exc
        if response.status_code >= 400:
            raise ProviderError(
                f'LLM API {response.status_code}: {response.text[:300]}'
            )
        data = response.json()
        try:
            return data['choices'][0]['message']['content'].strip()
        except (KeyError, IndexError) as exc:
            raise ProviderError('Неочікуваний формат відповіді LLM API') from exc


def get_provider():
    if settings.LLM_PROVIDER == 'openai_compatible':
        return OpenAICompatibleProvider(
            api_key=settings.LLM_OPENAI_API_KEY,
            base_url=settings.LLM_OPENAI_BASE_URL,
            model=settings.LLM_MODEL,
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )
    return MockProvider()


# --- шаблони mock-провайдера -----------------------------------------------

OPENING, DEBATE = 'opening', 'debate'
SYNTHESIS, DEVIL, FINAL = 'json_synthesis', 'json_devil', 'json_final'

_OPENING_TEMPLATES = {
    'logician': (
        'Аргумент 1: питання «{question}» має ключову змінну — мету. '
        'Аргумент 2: без критеріїв успіху будь-яке рішення неповноцінне. '
        'Висновок: спочатку визначмо критерії, потім порівняймо варіанти.'
    ),
    'skeptic': (
        'Я сумніваюся, що запитання «{question}» коректно сформульоване. '
        'Припущення «що рішення взагалі існує в уявленні автора» може бути хибним. '
        'Треба перевірити дані, перш ніж обирати будь-який варіант.'
    ),
    'creative': (
        'Нестандартний підхід: розгляньмо «{question}» з протилежного боку — '
        'що станеться, якщо зробити навпаки? Є ще варіант інверсії задачі '
        'та пошук аналогії з іншої сфери.'
    ),
    'emotional': (
        'Чесно: питання «{question}» — це не лише логіка, а й люди. '
        'Варто запитати себе, що я хочу відчувати через рік, якщо оберу цей шлях. '
        'Ігнорувати це — означає прийняти рішення, яке розчарує.'
    ),
    'pragmatist': (
        'По суті: у «{question}» важливі бюджет, терміни й перший крок. '
        'Найменший реалістичний крок — перевірити припущення на практиці '
        'протягом тижня, не витрачаючи всі ресурси одразу.'
    ),
}

_DEBATE_TEMPLATES = {
    'logician': (
        'Контраргумент до попередніх тез: висновок не випливає з доказів. '
        'Пропоную розділити твердження на перевірювані та ні, і працювати лише з першими.'
    ),
    'skeptic': (
        'Це слабке місце: аргумент спирається на припущення, яке ніхто не перевірив. '
        'Наведіть контрприклад або визнайте, що твердження слабке.'
    ),
    'creative': (
        'Є третій шлях, який усі пропустили: поєднати підходи A і B у мінімальну гібридну '
        'версію та протестувати її. Це дешевше за повний перегляд рішення.'
    ),
    'emotional': (
        'Мене не переконує цей аргумент — він занадто холодний. '
        'Якщо рішення працює на папері, але ламає людей, це не рішення, а проблема.'
    ),
    'pragmatist': (
        'Практичне зауваження: ідея хороша, але її вартість недооцінена. '
        'Потрібен план на випадок, якщо перший крок провалиться — інакше це не план, а надія.'
    ),
}


def _find_marker(prompt):
    for marker in (SYNTHESIS, DEVIL, FINAL, OPENING, DEBATE):
        if f'<<{marker}>>' in prompt:
            return marker
    return None


def _find_persona(prompt):
    for slug in ('logician', 'skeptic', 'creative', 'emotional', 'pragmatist', 'devil', 'moderator'):
        if f'<<persona:{slug}>>' in prompt:
            return slug
    return 'moderator'


def _find_mode(prompt):
    for mode in ('yes_no', 'choose_one', 'open'):
        if f'<<mode:{mode}>>' in prompt:
            return mode
    return 'open'


def _extract_options(prompt):
    for line in prompt.splitlines():
        if line.startswith('Варіанти:'):
            return [o.strip() for o in line.split(':', 1)[1].split(';') if o.strip()]
    return []


def _extract_question(prompt):
    for line in prompt.splitlines():
        if line.startswith('Запитання:'):
            return line.split(':', 1)[1].strip()
    return 'невідоме запитання'


def _mock_opening(persona, prompt):
    question = _extract_question(prompt)
    template = _OPENING_TEMPLATES.get(persona, _OPENING_TEMPLATES['logician'])
    return template.format(question=question)


def _mock_debate(persona, prompt):
    return _DEBATE_TEMPLATES.get(persona, _DEBATE_TEMPLATES['logician'])


def _mock_synthesis(prompt):
    question = _extract_question(prompt)
    mode = _find_mode(prompt)
    data = {
        'decision': f'Обрати найкращий варіант для: {question}',
        'reasoning': (
            'Більшість аргументів підтримують поміркований підхід: '
            'мінімальний тестовий крок замість радикальної зміни.'
        ),
        'supporting_arguments': [
            'Низький ризик і швидкий зворотний зв’язок',
            'Зберігає гнучкість для коригування рішення',
            'Враховує аргументи скептика й прагматика',
        ],
        'dissenting_points': [
            'Креативний підхід лишається нереалізованим',
        ],
    }
    if mode == 'yes_no':
        data['answer'] = 'так'
    elif mode == 'choose_one':
        options = _extract_options(prompt)
        data['answer'] = options[0] if options else 'варіант не визначено'
    return data


def _mock_devil(prompt):
    return {
        'verdict': 'Рішення не є безпечним — воно має слабкі місця.',
        'risks': [
            {
                'title': 'Оптимістична оцінка термінів',
                'description': 'Перший крок може затягнутися через неповні дані.',
                'severity': 'середня',
            },
            {
                'title': 'Слабка перевірка припущень',
                'description': 'Ключове припущення не перевірено на реальних даних.',
                'severity': 'висока',
            },
        ],
        'weak_spots': [
            'Незрозуміло, хто несе відповідальність за провал першого кроку',
            'Немає критерію, за яким рішення визнають невдалим',
        ],
        'counter_arguments': [
            'Тестовий крок — це ще не рішення, а відтермінування вибору',
        ],
    }


def _mock_final(prompt):
    mode = _find_mode(prompt)
    data = {
        'decision': 'Обрати поміркований підхід із чіткими критеріями відмови',
        'confirmed': True,
        'revision': '',
        'pros': [
            'Швидкий зворотний зв’язок',
            'Мінімальні початкові витрати',
            'Зберігає можливість змінити курс',
        ],
        'cons': [
            'Повільніший старт порівняно з рішучим рішенням',
            'Потрібна дисципліна у перевірці критеріїв',
        ],
        'risks': [
            'Затримка через неповні дані',
            'Втрата можливості, якщо ринок зміниться швидше',
        ],
        'confidence': 70,
        'recommendation': (
            'Сформулюйте два критерії провалу, дайте собі два тижні '
            'і зберіть дані, перш ніж робити остаточний вибір.'
        ),
    }
    if mode == 'yes_no':
        data['answer'] = 'так'
    elif mode == 'choose_one':
        options = _extract_options(prompt)
        data['answer'] = options[0] if options else 'варіант не визначено'
    return data
