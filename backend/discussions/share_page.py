"""Сторінка публічного посилання з OG-тегами для прев'ю в Telegram, Slack, Viber.

Інтерфейс — SPA: краулери месенджерів JavaScript не виконують і бачили б
лише «Clarity». Тому nginx віддає `/shared/<token>` бекенду, а той повертає
той самий index.html збірки фронтенду, лише з назвою й описом дискусії в
<head>. Далі сторінку як завжди малює SPA.
"""

import re
from functools import lru_cache
from html import escape
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csp import csp_override
from django.views.decorators.http import require_GET

from backend.i18n import L, using

from .models import Discussion
from .serializers import discussion_title

DESCRIPTION_MAX = 200
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
    html = _index_html(str(settings.FRONTEND_INDEX_HTML))
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
