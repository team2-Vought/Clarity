"""Сторінка публічного посилання з OG-тегами для прев'ю в Telegram, Slack, Viber.

Інтерфейс — SPA: краулери месенджерів JavaScript не виконують і бачили б
лише «Clarity». Тому nginx віддає `/shared/<token>` бекенду, а той повертає
той самий index.html збірки фронтенду, лише з назвою й описом дискусії в
<head>. Далі сторінку як завжди малює SPA.
"""

import logging
import re
import threading
import time
from functools import lru_cache
from html import escape
from pathlib import Path

import httpx
from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csp import csp_override
from django.views.decorators.http import require_GET

from backend.i18n import L, using

from .models import Discussion
from .serializers import discussion_title

logger = logging.getLogger(__name__)

DESCRIPTION_MAX = 200
# index.html з живого фронтенду (FRONTEND_INDEX_URL): скільки тримати копію
REMOTE_INDEX_TTL_SECONDS = 300
REMOTE_INDEX_TIMEOUT_SECONDS = 3
FALLBACK_HTML = (
    '<!doctype html><html><head><meta charset="UTF-8"><title>Clarity</title></head>'
    '<body><div id="root"></div></body></html>'
)


@lru_cache(maxsize=4)
def _read_index(path, mtime_ns, size):
    return Path(path).read_text(encoding='utf-8')


def _index_html(path):
    """index.html збірки. Кеш — за часом зміни й розміром файлу: після нового
    `npm run build` сторінка бере свіжі імена бандлів без перезапуску бекенду."""
    try:
        stat = Path(path).stat()
        return _read_index(path, stat.st_mtime_ns, stat.st_size)
    except OSError:
        return FALLBACK_HTML


_remote_lock = threading.Lock()
_remote_cache = {'url': '', 'html': '', 'at': 0.0}


def _remote_index_html(url):
    """index.html, який зараз віддає фронтенд (напр. Vercel). Інтерфейс там
    збирається окремо від образу бекенду, тож імена бандлів у локальній копії
    могли б не збігтися — і прев'ю відкрилося б порожнім. Копія живе
    REMOTE_INDEX_TTL_SECONDS; збій мережі — віддаємо останню вдалу, а без неї None."""
    now = time.monotonic()
    with _remote_lock:
        cached = dict(_remote_cache)
    if cached['url'] == url and cached['html'] and now - cached['at'] < REMOTE_INDEX_TTL_SECONDS:
        return cached['html']
    try:
        response = httpx.get(url, timeout=REMOTE_INDEX_TIMEOUT_SECONDS, follow_redirects=True)
        response.raise_for_status()
        html = response.text
        if '<div id="root">' not in html:
            raise ValueError('not the frontend index.html')
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning('FRONTEND_INDEX_URL is unavailable: %s', exc)
        return cached['html'] if cached['url'] == url and cached['html'] else None
    with _remote_lock:
        _remote_cache.update(url=url, html=html, at=now)
    return html


def _short(text, limit=DESCRIPTION_MAX):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + '…'


def _description(discussion):
    summary = discussion.final_summary or {}
    decision = summary.get('decision') or summary.get('answer') or ''
    if decision:
        return _short(L(f'Висновок: {decision}', f'Conclusion: {decision}'))
    return _short(L(
        'Дискусія AI-учасників у Clarity: аргументи за і проти, критика й висновок.',
        'An AI discussion on Clarity: arguments for and against, critique and a conclusion.',
    ))


def og_tags(discussion, url):
    site = settings.FRONTEND_URL.rstrip('/')
    with using(discussion.language):
        title = _short(discussion_title(discussion.question), 120)
        description = _description(discussion)
    tags = {
        'og:type': 'article',
        'og:site_name': 'Clarity',
        'og:title': title,
        'og:description': description,
        'og:url': url,
        'og:image': f'{site}/og-image.jpg',
        'og:image:width': '1200',
        'og:image:height': '630',
        'twitter:card': 'summary_large_image',
        'twitter:title': title,
        'twitter:description': description,
    }
    meta = ''.join(
        f'<meta {"name" if key.startswith("twitter:") else "property"}="{key}" content="{escape(value)}" />'
        for key, value in tags.items()
    )
    return title, meta + f'<meta name="description" content="{escape(description)}" />'


# інше — у CSP-<meta> зібраного index.html; frame-ancestors там не діє
@csp_override({'frame-ancestors': ["'none'"]})
@require_GET
def shared_page(request, token):
    remote_url = settings.FRONTEND_INDEX_URL
    html = (remote_url and _remote_index_html(remote_url)) or _index_html(str(settings.FRONTEND_INDEX_HTML))
    # типові теги сайту з index.html прибираємо: краулер бере перший og:title,
    # а недійсне посилання не має виглядати в прев'ю як робоча сторінка
    html = re.sub(r'<!-- og:start.*?<!-- og:end -->', '', html, count=1, flags=re.S)
    discussion = Discussion.objects.filter(share_token=token).first()
    if discussion is None:
        # SPA сама покаже «посилання недійсне»
        return HttpResponse(html, status=404)
    url = f'{settings.FRONTEND_URL.rstrip("/")}/shared/{token}'
    title, meta = og_tags(discussion, url)
    html = re.sub(r'<title>.*?</title>', f'<title>{escape(title)} · Clarity</title>', html, count=1, flags=re.S)
    html = html.replace('</head>', f'{meta}</head>', 1)
    response = HttpResponse(html)
    response['Cache-Control'] = 'no-cache'
    return response
