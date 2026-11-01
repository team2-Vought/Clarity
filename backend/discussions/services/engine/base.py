"""Спільне для всіх частин рушія: константи, помилки й план кроку."""

from __future__ import annotations

from dataclasses import dataclass, field

from backend.i18n import L


MAX_SEQ_STEP = 1
DEFAULT_TEMPERATURE = 0.7
JSON_TEMPERATURE = 0.2
MAX_ERROR_DETAIL = 4000
MAX_ERROR_PUBLIC = 300
MAX_PARALLEL_CALLS = 5
MAX_DEVIL_QUERIES = 2
STANCE_AGREE = 'згода'
STANCE_DISPUTE = 'суперечка'
USER_SLUG = 'user'


def generic_public_error():
    return L(
        'Не вдалося отримати відповідь від AI. Спробуйте ще раз.',
        'Could not get a response from the AI. Please try again.',
    )


class EngineError(Exception):
    """Помилка кроку.

    `public` — текст, який безпечно показати користувачу (без сирих відповідей
    провайдера); `retryable=False` — повтор без змін (моделі, ключа) не допоможе.
    """

    def __init__(self, message, *, detail='', code='engine_error', public='', retryable=True):
        super().__init__(message)
        self.detail = detail or message
        self.code = code
        self.public = (public or '')[:MAX_ERROR_PUBLIC]
        self.retryable = retryable


class EngineBusy(EngineError):
    """Інший запит уже виконує крок цієї дискусії."""


def daily_limit_error():
    """Крок не вміщується в денний ліміт AI-відповідей — повтор сьогодні не допоможе."""
    from .. import usage

    return EngineError(
        'Денний ліміт AI-відповідей вичерпано.',
        code='daily_limit',
        public=usage.reply_limit_message(),
        retryable=False,
    )


class EngineConflict(EngineError):
    """Стан дискусії змінився, поки виконувався LLM-виклик."""


@dataclass
class StepPlan:
    phase: str
    role: str
    persona: dict
    model_id: str
    system: str
    prompt: str
    temperature: float
    reply_to: str = ''
    reply_to_slug: str = ''
    debate_round: int | None = None
    json_kind: str | None = None
    fallback_models: list = field(default_factory=list)
    can_search: bool = False
    # своя перевірка JSON (data, mode, options) -> [проблеми], якщо кроку мало загальної
    check: object = None
    # модель, яка справді відповіла (судді можуть перейти на запасну)
    used_model: str = ''
