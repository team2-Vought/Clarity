"""Виклики моделей і пошуку для одного кроку: повтори JSON, запасні моделі судді,
паралельні виклики учасників.
"""

from __future__ import annotations

import contextvars
import logging
import queue
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings

from backend.i18n import L

from ...models import Message
from .. import reply_language, search, usage
from ..catalog import model_label, paid_by_user
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
    daily_limit_error,
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
from .. import model_health
from .context import _mode_ctx, _resolved_personas
from .live import _drafts, _set_live

logger = logging.getLogger(__name__)


# збої, після яких варто спробувати іншу модель: решта — не про модель
FALLBACK_CODES = frozenset({
    'provider_error',
    'provider_config',
    'provider_quota',
    'provider_timeout',
    'model_swapped',
    'empty_response',
})


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
    # квота чи ключ не оживуть за хвилину — модель якийсь час оминаємо
    if getattr(exc, 'quota', False):
        model_health.mark_down(model_id, model_health.QUOTA)
    elif getattr(exc, 'config', False):
        model_health.mark_down(model_id, model_health.KEY)
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


class _Abandoned(Exception):
    """Виклик моделі покинуто: `reason` — 'timeout', 'swap' (людина попросила
    замінити модель) або 'stopped' (крок зупинили)."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


# як часто сторожовий потік передає чернетку й перевіряє дедлайн; і як часто
# питає базу, чи не попросили замінити модель
WATCH_TICK_SECONDS = 0.2
CANCEL_CHECK_SECONDS = 1.0


def _watched(call, *, on_text, deadline, cancelled):
    """Виконує `call(on_text)` у окремому потоці з загальним дедлайном.

    Потік провайдера лише чекає мережу; чернетки він кладе в чергу, а записує
    їх у базу цей (викликаючий) потік — так база не бачить нових потоків.
    Якщо модель мовчить довше за `deadline` або `cancelled()` повертає причину,
    виклик покидається: потік провайдера доживе до свого мережевого таймауту,
    але його текст уже нікуди не піде.
    """
    updates = queue.SimpleQueue()
    outcome = {}
    done = threading.Event()
    abandoned = threading.Event()

    def relay(text):
        if not abandoned.is_set():
            updates.put(text)

    def work():
        try:
            outcome['text'] = call(relay if on_text is not None else None)
        except BaseException as exc:  # noqa: BLE001 — передаємо в потік кроку
            outcome['error'] = exc
        finally:
            done.set()

    threading.Thread(
        target=contextvars.copy_context().run, args=(work,), daemon=True
    ).start()
    started = time.monotonic()
    next_check = started + CANCEL_CHECK_SECONDS
    while True:
        finished = done.wait(WATCH_TICK_SECONDS)
        latest = None
        while True:
            try:
                latest = updates.get_nowait()
            except queue.Empty:
                break
        if latest is not None and on_text is not None:
            on_text(latest)
        if finished:
            break
        now = time.monotonic()
        if deadline and now - started > deadline:
            abandoned.set()
            raise _Abandoned('timeout')
        if cancelled is not None and now >= next_check:
            next_check = now + CANCEL_CHECK_SECONDS
            reason = cancelled()
            if reason:
                abandoned.set()
                raise _Abandoned(reason)
    if 'error' in outcome:
        raise outcome['error']
    return outcome.get('text')


def _abandoned_error(model_id, exc):
    label = model_label(model_id)
    if exc.reason == 'stopped':
        return EngineError(
            'Крок зупинено.', detail=f'{model_id}: stopped', code='stopped', retryable=False
        )
    if exc.reason == 'swap':
        return EngineError(
            'Модель замінено на прохання людини.',
            detail=f'{model_id}: swapped by user',
            code='model_swapped',
            public=L(
                f'Модель «{label}» замінено на вашу вимогу.',
                f'The model “{label}” was replaced at your request.',
            ),
        )
    return EngineError(
        'Модель не відповіла вчасно.',
        detail=f'{model_id}: deadline exceeded',
        code='provider_timeout',
        public=L(
            f'Модель «{label}» не відповіла вчасно. Спробуйте ще раз або оберіть іншу модель.',
            f'The model “{label}” did not respond in time. Try again or choose another model.',
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
    reply_in_user_language=True,
    deadline=None,
    cancelled=None,
):
    """Один виклик моделі із загальним дедлайном (типово — з налаштувань:
    для JSON суддів довший). `cancelled()` — причина покинути виклик або ''."""
    started = time.monotonic()
    # пишемо людині її мовою: мову питання називаємо в кінці системного промпту
    language = reply_language.instruction() if reply_in_user_language else ''
    if language:
        system = f'{system}\n\n{language}'
    if deadline is None:
        deadline = (
            settings.LLM_JUDGE_DEADLINE_SECONDS if json_mode else settings.LLM_CALL_DEADLINE_SECONDS
        )
    try:
        provider = provider_factory(model_id) if provider_factory else get_provider(model_id)
        streams = on_text is not None and getattr(provider, 'supports_streaming', False)

        def call(relay):
            kwargs = {'json_mode': True} if json_mode else {}
            if streams and relay is not None:
                kwargs['on_text'] = relay
            return provider.complete(
                system=system,
                prompt=prompt,
                temperature=temperature,
                **kwargs,
            )

        if settings.LLM_WATCHDOG:
            text = _watched(
                call,
                on_text=on_text if streams else None,
                deadline=deadline,
                cancelled=cancelled,
            )
        else:
            text = call(on_text if streams else None)
    except _Abandoned as exc:
        logger.warning(
            'LLM call abandoned',
            extra={'model': model_id, 'reason': exc.reason, 'seconds': round(time.monotonic() - started, 1)},
        )
        raise _abandoned_error(model_id, exc) from exc
    except ProviderError as exc:
        logger.warning(
            'LLM provider error',
            extra={'model': model_id, 'error': str(exc)},
        )
        raise _provider_failure(model_id, exc) from exc
    except EngineError:
        raise
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


def server_paid_count(plans):
    """Скільки викликів кроку оплачує сервер: виклики власними ключами людини
    в денний ліміт не рахуються. Позначає такі плани як зараховані."""
    count = 0
    for plan in plans:
        if not paid_by_user(plan.model_id):
            plan.billed = True
            count += 1
    return count


def _bill(plan, model_id, user_id):
    """Перед викликом запасної моделі: якщо за неї платить сервер, а план ще не
    зараховано в ліміт, — зараховуємо. False — ліміт вичерпано, модель пропускаємо."""
    if plan.billed or paid_by_user(model_id):
        return True
    if not usage.reserve_replies(user_id, 1):
        return False
    plan.billed = True
    return True


def _run_json_plan(plan, provider_factory, discussion):
    """JSON-крок судді з перемиканням на наступну модель, якщо поточна впала."""
    mode, options = _mode_ctx(discussion)
    models = [plan.model_id, *[m for m in plan.fallback_models if m != plan.model_id]]
    last_error = None
    for model_id in models:
        if not _bill(plan, model_id, discussion.user_id):
            last_error = daily_limit_error()
            continue
        try:
            data = _complete_json(provider_factory, plan, model_id, mode, options)
        except EngineError as exc:
            if exc.code not in FALLBACK_CODES:
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




def _complete_persona(plan, provider_factory, discussion, board):
    """Репліка учасника його моделлю; якщо модель не відповіла — запасною.

    Запасні моделі (`plan.fallback_models`) готує `_prepare_step`; людина може
    вимкнути автозаміну, але кнопка «Замінити модель» працює й тоді
    (`plan.swap_models`). Модель, що мовчить довше за дедлайн, теж замінюється.
    Повідомлення зберігається з моделлю, що справді відповіла (`plan.used_model`).
    """
    fallbacks = [m for m in plan.fallback_models if m != plan.model_id]
    # своя модель учасника «відпочиває» після збою квоти чи ключа — спершу запасні
    if fallbacks and model_health.down_reason(plan.model_id):
        models = [*fallbacks, plan.model_id]
    else:
        models = [plan.model_id, *fallbacks]
    spare = [m for m in plan.swap_models if m not in models]
    slug = plan.persona['slug']
    last_error = None
    index = 0
    while index < len(models):
        model_id = models[index]
        index += 1
        if model_id != plan.model_id and not _bill(plan, model_id, discussion.user_id):
            last_error = daily_limit_error()
            continue
        if board is not None:
            board.attempt(plan, model_id)
        try:
            raw = _complete(
                provider_factory,
                model_id,
                plan.system,
                plan.prompt,
                plan.temperature,
                on_text=(lambda text: board.update(plan, text)) if board is not None else None,
                cancelled=board.cancel_check(slug) if board is not None else None,
            )
        except EngineError as exc:
            if exc.code not in FALLBACK_CODES:
                raise
            # людина просить іншу модель, а запасних не лишилось — беремо з ручного списку
            if exc.code == 'model_swapped' and index >= len(models) and spare:
                models.append(spare.pop(0))
            # упали всі — людина бачить помилку саме моделі, яку обрала
            last_error = last_error if model_id != plan.model_id else exc
            logger.warning(
                'Participant model failed, trying fallback',
                extra={'model': model_id, 'code': exc.code},
            )
            continue
        if model_id != plan.model_id:
            plan.used_model = model_id
        if board is not None:
            board.finish(plan, raw)
        return raw
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
        raw = _complete_persona(plan, provider_factory, discussion, board)
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
