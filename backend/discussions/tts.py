"""Озвучення реплік AI-голосом (Gemini TTS).

Браузерний синтез звучить як робот, тож репліку читає модель мовлення:
кожен учасник — своїм голосом і манерою. Ключ — власний ключ Gemini людини,
інакше ключ сервера. Немає жодного — 503, і фронтенд читає браузерним голосом.
"""

import base64
import io
import logging
import time
import wave
from collections import OrderedDict

import httpx
from django.conf import settings
from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .services.catalog import _provider_key, user_context

logger = logging.getLogger(__name__)

GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
MAX_CHARS = 1500

# Голос кожної ролі: характер чути одразу, ще до змісту. Інструкцію про манеру
# в текст не додаємо — модель частину її зачитує вголос.
VOICES = {
    'moderator': 'Charon',  # спокійний, інформативний
    'devil': 'Algenib',  # низький, з хрипотою
    'logician': 'Iapetus',  # чіткий
    'skeptic': 'Alnilam',  # твердий
    'creative': 'Puck',  # жвавий
    'emotional': 'Sulafat',  # теплий
    'pragmatist': 'Orus',  # діловий
}
# власні ролі — сталий голос за хешем slug
POOL = ['Achird', 'Aoede', 'Kore', 'Umbriel', 'Sadaltager', 'Despina', 'Rasalgethi', 'Leda']


def voice_for(key):
    if key in VOICES:
        return VOICES[key]
    h = 0
    for ch in str(key or ''):
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return POOL[h % len(POOL)]


def _pcm_to_wav(pcm, rate=24000):
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return out.getvalue()


def _rate_of(mime):
    for part in mime.split(';'):
        name, _, value = part.strip().partition('=')
        if name == 'rate' and value.isdigit():
            return int(value)
    return 24000


# Безкоштовний ключ Gemini дає ~10 запитів на день на КОЖНУ TTS-модель. Тож коли одна
# вичерпана (429), пробуємо наступну, а вичерпану не чіпаємо, доки Google не скаже.
FALLBACK_MODELS = [
    'gemini-3.8-flash-tts',
    'gemini-3.8-flash-lite-tts',
    'gemini-3.1-flash-tts-preview',
    'gemini-2.5-flash-preview-tts',
]
_exhausted_until = {}  # модель -> time.monotonic(), до якого вона на ліміті
_cache = OrderedDict()  # (голос, текст) -> WAV; повтор репліки не витрачає ліміт
CACHE_SIZE = 24
# звичайна репліка готова за 5–12 с; довше — модель зависла, беремо іншу
REQUEST_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
QUOTA_PAUSE_DEFAULT = 60.0
QUOTA_PAUSE_MAX = 6 * 3600.0


class QuotaExhausted(Exception):
    """Усі TTS-моделі на ліміті провайдера."""


def _models():
    names = [settings.TTS_GEMINI_MODEL, *FALLBACK_MODELS]
    return list(dict.fromkeys(name for name in names if name))


def _retry_after(response):
    """Скільки Google радить чекати (з деталей 429), у секундах."""
    try:
        details = response.json().get('error', {}).get('details', [])
    except ValueError:
        return QUOTA_PAUSE_DEFAULT
    for detail in details:
        delay = str(detail.get('retryDelay') or '')
        if delay.endswith('s'):
            try:
                return min(float(delay[:-1]), QUOTA_PAUSE_MAX)
            except ValueError:
                pass
    return QUOTA_PAUSE_DEFAULT


def _request(model, api_key, text, voice):
    return httpx.post(
        GEMINI_URL.format(model=model),
        headers={'x-goog-api-key': api_key},
        json={
            'contents': [{'parts': [{'text': text}]}],
            'generationConfig': {
                'responseModalities': ['AUDIO'],
                'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}},
            },
        },
        timeout=REQUEST_TIMEOUT,
    )


def synthesize(text, key):
    """WAV-байти репліки або None, якщо ключа немає.
    Усі моделі на ліміті — QuotaExhausted; інший збій провайдера — httpx/KeyError."""
    api_key = _provider_key('gemini')
    if not api_key:
        return None
    voice = voice_for(key)
    cache_key = (voice, text)
    if cache_key in _cache:
        _cache.move_to_end(cache_key)
        return _cache[cache_key]

    now = time.monotonic()
    failure = None
    for model in _models():
        if _exhausted_until.get(model, 0) > now:
            continue
        try:
            response = _request(model, api_key, text, voice)
        except httpx.TimeoutException as exc:
            # модель інколи «зависає» — не чекаємо, а пробуємо іншу
            failure = exc
            logger.info('TTS model %s timed out, trying the next one', model)
            continue
        if response.status_code == 429:
            _exhausted_until[model] = now + _retry_after(response)
            logger.info('TTS model %s hit the quota, trying the next one', model)
            continue
        # модель не існує для цього ключа — більше не пробуємо її до перезапуску
        if response.status_code == 404:
            _exhausted_until[model] = now + QUOTA_PAUSE_MAX
            continue
        try:
            response.raise_for_status()
            data = response.json()['candidates'][0]['content']['parts'][0]['inlineData']
            audio = base64.b64decode(data['data'])
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            # 5xx або відповідь без аудіо — інша модель може впоратись
            failure = exc
            logger.info('TTS model %s failed (%s), trying the next one', model, exc)
            continue
        mime = data.get('mimeType', '')
        if not (mime.startswith('audio/wav') or audio[:4] == b'RIFF'):
            audio = _pcm_to_wav(audio, _rate_of(mime))
        break
    else:
        if failure is not None:
            raise failure
        raise QuotaExhausted()

    _cache[cache_key] = audio
    while len(_cache) > CACHE_SIZE:
        _cache.popitem(last=False)
    return audio


class SpeechView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'tts'

    def post(self, request):
        text = str(request.data.get('text') or '').strip()[:MAX_CHARS]
        key = str(request.data.get('voice') or '')[:64]
        if not text:
            return Response({'detail': 'Порожній текст.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            with user_context(request.user):
                audio = synthesize(text, key)
        except QuotaExhausted:
            # фронтенд до перезавантаження читає браузерним голосом
            return Response({'detail': 'tts_quota'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            logger.warning('TTS failed: %s', exc)
            return Response({'detail': 'tts_failed'}, status=status.HTTP_502_BAD_GATEWAY)
        if audio is None:
            return Response({'detail': 'tts_unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        reply = HttpResponse(audio, content_type='audio/wav')
        reply['Cache-Control'] = 'private, max-age=86400'
        return reply
