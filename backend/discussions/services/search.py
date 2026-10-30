"""Пошук в інтернеті для AI-учасників дискусії.

Моделі самі формулюють пошукові запити (етап пошуку джерел, службовий рядок
ПОШУК у репліках, поле search_queries у відповіді AI Devil), а бекенд виконує
їх через один із провайдерів:

- Tavily (TAVILY_API_KEY) — найкращі витяги зі сторінок;
- Brave Search (BRAVE_SEARCH_API_KEY);
- SearXNG (SEARXNG_URL) — власний метапошуковик без ключа;
- Wikipedia — без ключа, запасний варіант для базових фактів.

Такий підхід однаково працює з усіма LLM-провайдерами й не потребує
підтримки tool calling.
"""

import html
import logging
import re
from urllib.parse import quote, urlparse

import httpx
from django.conf import settings

from backend.i18n import L

logger = logging.getLogger(__name__)

USER_AGENT = 'ClarityDebate/1.0 (+https://github.com/ttjelky/Clarity)'
SNIPPET_LIMIT = 600
TITLE_LIMIT = 200
QUERY_LIMIT = 200

PROVIDER_LABELS = {
    'tavily': 'Tavily',
    'brave': 'Brave Search',
    'searxng': 'SearXNG',
    'wikipedia': 'Wikipedia',
}

_TAG_RE = re.compile(r'<[^>]+>')


class SearchError(Exception):
    """Пошук не вдався (мережа, ключ, формат відповіді)."""


def _clean(value, limit):
    text = html.unescape(_TAG_RE.sub('', str(value or '')))
    text = ' '.join(text.split())
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + '…'
    return text


def provider_id():
    """Активний провайдер пошуку або '' — якщо пошук вимкнено."""
    configured = str(getattr(settings, 'SEARCH_PROVIDER', 'auto') or 'auto').strip().lower()
    if configured in {'off', 'none', 'false', '0'}:
        return ''
    keys = {
        'tavily': getattr(settings, 'TAVILY_API_KEY', ''),
        'brave': getattr(settings, 'BRAVE_SEARCH_API_KEY', ''),
        'searxng': getattr(settings, 'SEARXNG_URL', ''),
        'wikipedia': 'always',
    }
    if configured in keys:
        return configured if keys[configured] else ''
    for candidate in ('tavily', 'brave', 'searxng'):
        if keys[candidate]:
            return candidate
    return 'wikipedia'


def is_available():
    return bool(provider_id())


def status():
    current = provider_id()
    return {
        'available': bool(current),
        'provider': PROVIDER_LABELS.get(current, ''),
        # Wikipedia — лише енциклопедичні факти, без новин і цін
        'limited': current == 'wikipedia',
    }


def normalize_query(value):
    return ' '.join(str(value or '').split())[:QUERY_LIMIT].strip(' "«»')


def _get(url, **kwargs):
    headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json'}
    headers.update(kwargs.pop('headers', {}))
    try:
        response = httpx.get(
            url, headers=headers, timeout=settings.SEARCH_TIMEOUT_SECONDS, **kwargs
        )
    except httpx.HTTPError as exc:
        raise SearchError(f'мережа: {exc}') from exc
    return _json(response)


def _post(url, **kwargs):
    headers = {'User-Agent': USER_AGENT, 'Content-Type': 'application/json'}
    headers.update(kwargs.pop('headers', {}))
    try:
        response = httpx.post(
            url, headers=headers, timeout=settings.SEARCH_TIMEOUT_SECONDS, **kwargs
        )
    except httpx.HTTPError as exc:
        raise SearchError(f'мережа: {exc}') from exc
    return _json(response)


def _json(response):
    if response.status_code >= 400:
        raise SearchError(f'HTTP {response.status_code}')
    try:
        return response.json()
    except ValueError as exc:
        raise SearchError('відповідь не є JSON') from exc


def _item(title, url, snippet):
    url = str(url or '').strip()
    if not url.startswith(('http://', 'https://')):
        return None
    title = _clean(title, TITLE_LIMIT) or urlparse(url).netloc
    return {'title': title, 'url': url, 'snippet': _clean(snippet, SNIPPET_LIMIT)}


def _tavily(query, limit):
    data = _post(
        'https://api.tavily.com/search',
        headers={'Authorization': f'Bearer {settings.TAVILY_API_KEY}'},
        json={'query': query, 'max_results': limit, 'search_depth': 'basic'},
    )
    return [
        _item(row.get('title'), row.get('url'), row.get('content'))
        for row in data.get('results') or []
        if isinstance(row, dict)
    ]


def _brave(query, limit):
    data = _get(
        'https://api.search.brave.com/res/v1/web/search',
        params={'q': query, 'count': limit},
        headers={'X-Subscription-Token': settings.BRAVE_SEARCH_API_KEY},
    )
    rows = (data.get('web') or {}).get('results') or []
    return [
        _item(
            row.get('title'),
            row.get('url'),
            ' '.join([row.get('description') or '', *(row.get('extra_snippets') or [])]),
        )
        for row in rows
        if isinstance(row, dict)
    ]


def _searxng(query, limit):
    base = settings.SEARXNG_URL.rstrip('/')
    data = _get(f'{base}/search', params={'q': query, 'format': 'json'})
    return [
        _item(row.get('title'), row.get('url'), row.get('content'))
        for row in (data.get('results') or [])[:limit]
        if isinstance(row, dict)
    ]


def _wikipedia(query, limit):
    results = []
    # спершу Вікіпедія мовою дискусії, потім інша
    for lang in L(('uk', 'en'), ('en', 'uk')):
        data = _get(
            f'https://{lang}.wikipedia.org/w/api.php',
            params={
                'action': 'query',
                'list': 'search',
                'srsearch': query,
                'srlimit': limit,
                'format': 'json',
                'utf8': 1,
            },
        )
        for row in (data.get('query') or {}).get('search') or []:
            title = row.get('title') or ''
            url = f'https://{lang}.wikipedia.org/wiki/{quote(title.replace(" ", "_"))}'
            results.append(_item(title, url, row.get('snippet')))
        if results:
            break
    return results


BACKENDS = {
    'tavily': _tavily,
    'brave': _brave,
    'searxng': _searxng,
    'wikipedia': _wikipedia,
}


def search(query, limit=None):
    """Повертає [{title, url, snippet}] або кидає SearchError."""
    current = provider_id()
    if not current:
        raise SearchError('пошук вимкнено')
    query = normalize_query(query)
    if not query:
        return []
    limit = max(1, min(10, int(limit or settings.SEARCH_MAX_RESULTS)))
    try:
        items = BACKENDS[current](query, limit)
    except SearchError:
        raise
    except Exception as exc:  # неочікуваний формат відповіді провайдера
        raise SearchError(f'{type(exc).__name__}: {exc}') from exc
    unique = []
    seen = set()
    for item in items:
        if item and item['url'] not in seen:
            seen.add(item['url'])
            unique.append(item)
    logger.info('Web search finished', extra={'provider': current, 'results': len(unique)})
    return unique[:limit]
