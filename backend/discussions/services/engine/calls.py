"""Виклики моделей і пошуку для одного кроку: повтори JSON, запасні моделі судді,
паралельні виклики учасників.
"""

from __future__ import annotations

import contextvars
import logging
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from backend.i18n import L

from ...models import Message
from .. import search
from ..catalog import model_label
from ..providers import ProviderError, get_provider
from ..criteria import normalize_scores
from ..safety import normalize_topic
from .base import (
    DEFAULT_TEMPERATURE,
    EngineError,
    JSON_TEMPERATURE,
    MAX_DEVIL_QUERIES,
    MAX_ERROR_PUBLIC,
    MAX_PARALLEL_CALLS,
    generic_public_error,
)
from .parsing import (
    PROBLEM_CHECKS,
    _extract_json,
    _queries,
    normalize_review,
    normalize_solution,
    normalize_summary,
    parse_reply,
)
from .context import _mode_ctx, _resolved_personas
from .live import _drafts, _set_live

logger = logging.getLogger(__name__)


def _json_repair_prompt(plan, raw, problems):
    issues = '; '.join(problems) if problems else L(
        'формат не відповідає схемі', 'the format does not match the schema'
    )
    note = L(
        f'ВАЖЛИВО: попередня відповідь була невалідною або неповною ({issues}). '
        'Поверни ЛИШЕ один валідний JSON-об’єкт за схемою вище, без markdown, '
        'коментарів і тексту до/після нього. Ось попередня відповідь для виправлення:\n',
        f'IMPORTANT: the previous reply was invalid or incomplete ({issues}). '
        'Return ONLY a single valid JSON object following the schema above, with no '
        'markdown, comments or text before/after it. Here is the previous reply to fix:\n',
    )
    return f'{plan.prompt}\n\n{note}{str(raw)[:4000]}'


def _provider_failure(model_id, exc):
    label = model_label(model_id)
    if getattr(exc, 'quota', False):
        return EngineError(
            'Квоту моделі вичерпано.',
            detail=f'{model_id}: {exc}',
            code='provider_quota',
            public=L(
                f'У моделі «{label}» вичерпано квоту або ліміт тарифу. '
                'Оберіть іншу модель або поповніть баланс у провайдера.',
                f'The model “{label}” has run out of quota or hit its plan limit. '
                'Choose another model or top up your balance with the provider.',
            ),
            retryable=False,
        )
    if getattr(exc, 'config', False):
        return EngineError(
            'Модель недоступна.',
            detail=f'{model_id}: {exc}',
            code='provider_config',
            public=L(
                f'Модель «{label}» недоступна (немає або невірний API-ключ, '
                'модель не знайдено). Оберіть іншу модель.',
                f'The model “{label}” is unavailable (missing or invalid API key, '
                'or the model was not found). Choose another model.',
            ),
            retryable=False,
        )
    return EngineError(
        'Модель не змогла відповісти. Спробуйте ще раз.',
        detail=f'{model_id}: {exc}',
        code='provider_error',
        public=L(
            f'Модель «{label}» тимчасово не відповідає. Спробуйте ще раз.',
            f'The model “{label}” is temporarily not responding. Please try again.',
        ),
    )


def _complete(
    provider_factory,
    model_id,
    system,
    prompt,
    temperature=DEFAULT_TEMPERATURE,
    json_mode=False,
    on_text=None,
):
    started = time.monotonic()
    kwargs = {'json_mode': True} if json_mode else {}
    try:
        provider = provider_factory(model_id) if provider_factory else get_provider(model_id)
        if on_text is not None and getattr(provider, 'supports_streaming', False):
            kwargs['on_text'] = on_text
        text = provider.complete(
            system=system,
            prompt=prompt,
            temperature=temperature,
            **kwargs,
        )
    except ProviderError as exc:
        logger.warning(
            'LLM provider error',
            extra={'model': model_id, 'error': str(exc)},
        )
        raise _provider_failure(model_id, exc) from exc
    except Exception as exc:
        logger.exception('Unexpected LLM provider failure', extra={'model': model_id})
        raise EngineError(
            'Під час звернення до моделі сталася помилка. Спробуйте ще раз.',
            detail=f'{model_id}: {type(exc).__name__}: {exc}',
            code='provider_error',
            public=L(
                f'Модель «{model_label(model_id)}» повернула помилку. Спробуйте ще раз.',
                f'The model “{model_label(model_id)}” returned an error. Please try again.',
            ),
        ) from exc

    if not isinstance(text, str) or not text.strip():
        raise EngineError(
            'Модель повернула порожню відповідь. Спробуйте ще раз.',
            detail=f'{model_id}: empty completion',
            code='empty_response',
            public=L(
                f'Модель «{model_label(model_id)}» повернула порожню відповідь.',
                f'The model “{model_label(model_id)}” returned an empty response.',
            ),
        )

    logger.info(
        'LLM completion finished',
        extra={'model': model_id, 'seconds': round(time.monotonic() - started, 2)},
    )
    return text.strip()


def _complete_json(provider_factory, plan, model_id, mode, options):
    check = plan.check or PROBLEM_CHECKS[plan.json_kind]
    raw = _complete(
        provider_factory, model_id, plan.system, plan.prompt, plan.temperature, json_mode=True
    )
    data = _extract_json(raw)
    problems = check(data, mode, options)
    if problems:
        logger.warning(
            'Invalid JSON completion, requesting repair',
            extra={'model': model_id, 'kind': plan.json_kind, 'problems': problems},
        )
        repaired = _complete(
            provider_factory,
            model_id,
            plan.system,
            _json_repair_prompt(plan, raw, problems),
            JSON_TEMPERATURE,
            json_mode=True,
        )
        fixed = _extract_json(repaired)
        if fixed is not None and len(check(fixed, mode, options)) <= len(problems):
            data = fixed
    return data if isinstance(data, dict) else {}


def _run_searches(queries):
    """[(query, results)] для кожного запиту; помилки пошуку не зупиняють крок."""
    queries = [query for query in queries if query]
    if not queries:
        return []
    _set_live(live_search=queries[0])
    try:
        return _search_all(queries)
    finally:
        _set_live(live_search='')


def _search_all(queries):
    def run(query):
        try:
            return query, search.search(query)
        except search.SearchError as exc:
            logger.warning('Web search failed', extra={'query': query, 'error': str(exc)})
            return query, []

    if len(queries) == 1:
        return [run(queries[0])]
    with ThreadPoolExecutor(max_workers=min(len(queries), MAX_PARALLEL_CALLS)) as pool:
        return list(pool.map(run, queries))


def _run_json_plan(plan, provider_factory, discussion):
    """JSON-крок судді з перемиканням на наступну модель, якщо поточна впала."""
    mode, options = _mode_ctx(discussion)
    models = [plan.model_id, *[m for m in plan.fallback_models if m != plan.model_id]]
    last_error = None
    for model_id in models:
        try:
            data = _complete_json(provider_factory, plan, model_id, mode, options)
        except EngineError as exc:
            if exc.code not in {
                'provider_error',
                'provider_config',
                'provider_quota',
                'empty_response',
            }:
                raise
            last_error = exc
            logger.warning(
                'Judge model failed, trying fallback',
                extra={'model': model_id, 'kind': plan.json_kind},
            )
            continue
        plan.used_model = model_id
        return model_id, data
    raise last_error


def _majority_stance(discussion, personas):
    """Найпоширеніша остання позиція учасників (для режимів з вибором)."""
    latest = {}
    for message in discussion.messages.filter(role=Message.Role.AI).order_by('seq'):
        if message.stance:
            latest[message.persona_slug] = message.stance
    values = [latest[p['slug']] for p in personas if latest.get(p['slug'])]
    if not values:
        return ''
    (value, count), *rest = Counter(values).most_common()
    if rest and rest[0][1] == count:
        return ''
    return value


def _run_plan(plan, provider_factory, discussion):
    mode, options = _mode_ctx(discussion)
    if plan.json_kind is None:
        board = _drafts.get()
        raw = _complete(
            provider_factory,
            plan.model_id,
            plan.system,
            plan.prompt,
            plan.temperature,
            on_text=(lambda text: board.update(plan, text)) if board is not None else None,
        )
        reply = parse_reply(raw, mode, options)
        if not plan.can_search:
            reply['search_query'] = ''
        reply['search'] = _run_searches([reply['search_query']])
        return reply

    _, data = _run_json_plan(plan, provider_factory, discussion)
    if plan.json_kind == 'scores':
        return normalize_scores(data, options, discussion.criteria)
    if plan.json_kind == 'quick':
        summary = normalize_summary(data, {}, mode, options)
        summary['topic'] = normalize_topic(data.get('topic'))
        return summary
    if plan.json_kind == 'solution':
        return normalize_solution(
            data,
            mode,
            options,
            fallback_answer=_majority_stance(discussion, _resolved_personas(discussion)),
        )
    if plan.json_kind == 'review':
        queries = _queries(data.get('search_queries'), MAX_DEVIL_QUERIES) if plan.can_search else []
        return {'review': normalize_review(data), 'search': _run_searches(queries)}
    return normalize_summary(data, discussion.best_solution or {}, mode, options)


def _run_plans(plans, provider_factory, discussion):
    """Виконує виклики (паралельно, якщо їх кілька). Повертає [(plan, payload, error)]."""
    if len(plans) == 1:
        plan = plans[0]
        return [(plan, _run_plan(plan, provider_factory, discussion), None)]

    results = []
    workers = max(1, min(len(plans), MAX_PARALLEL_CALLS))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        # кожен виклик — у копії поточного контексту: так потоки бачать ключі користувача
        futures = [
            pool.submit(
                contextvars.copy_context().run, _run_plan, plan, provider_factory, discussion
            )
            for plan in plans
        ]
        for plan, future in zip(plans, futures):
            try:
                results.append((plan, future.result(), None))
            except EngineError as exc:
                exc.public = (
                    f'{plan.persona["name"]}: {exc.public or generic_public_error()}'
                )[:MAX_ERROR_PUBLIC]
                results.append((plan, None, exc))
            except Exception as exc:
                logger.exception('Unexpected parallel step failure')
                results.append(
                    (
                        plan,
                        None,
                        EngineError(
                            'Не вдалося отримати відповідь учасника.',
                            detail=f'{type(exc).__name__}: {exc}',
                            code='internal_error',
                            public=L(
                                f'{plan.persona["name"]}: не вдалося отримати відповідь.',
                                f'{plan.persona["name"]}: could not get a response.',
                            ),
                        ),
                    )
                )
    return results
