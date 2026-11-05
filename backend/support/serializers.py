from urllib.parse import urlsplit

from rest_framework import serializers

from backend.i18n import L
from discussions.models import Discussion, Message

from .models import BugReport

DESCRIPTION_MIN = 10
DESCRIPTION_MAX = 4000

# технічні дані — лише ці поля й коротко: так у звернення не потрапить зайве
CONTEXT_TEXT_FIELDS = {
    'user_agent': 400,
    'language': 16,
    'theme': 16,
    'viewport': 24,
    'screen': 24,
    'timezone': 64,
    'vision': 200,
    'build': 40,
}
CONTEXT_ERRORS_MAX = 10
ERROR_FIELDS = {'kind': 24, 'message': 300, 'source': 200, 'at': 32}

# у шляхах цих сторінок — токени (скидання пароля, підтвердження пошти, посилання)
TOKEN_PAGES = ('/reset-password/', '/confirm-email/', '/unsubscribe/', '/shared/')


def _clip(value, limit):
    return ' '.join(str(value or '').split())[:limit]


def clean_context(raw):
    """Лишає з технічних даних тільки дозволене й обрізає довге."""
    if not isinstance(raw, dict):
        return {}
    context = {}
    for name, limit in CONTEXT_TEXT_FIELDS.items():
        value = _clip(raw.get(name), limit)
        if value:
            context[name] = value
    if isinstance(raw.get('online'), bool):
        context['online'] = raw['online']
    errors = raw.get('errors')
    if isinstance(errors, list):
        cleaned = []
        for item in errors[-CONTEXT_ERRORS_MAX:]:
            if not isinstance(item, dict):
                continue
            row = {name: _clip(item.get(name), limit) for name, limit in ERROR_FIELDS.items()}
            row = {name: value for name, value in row.items() if value}
            if row.get('message'):
                cleaned.append(row)
        if cleaned:
            context['errors'] = cleaned
    return context


def clean_page(value):
    """Лише шлях сторінки: у query й # бувають токени, а на деяких сторінках — і в шляху."""
    path = urlsplit(str(value or '')).path or ''
    for prefix in TOKEN_PAGES:
        if path.startswith(prefix):
            return prefix + '…'
    return path[:300]


class BugReportSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=BugReport.Kind.choices, default=BugReport.Kind.BUG)
    description = serializers.CharField(max_length=DESCRIPTION_MAX)
    page = serializers.CharField(max_length=2000, required=False, allow_blank=True, default='')
    # гість вказує пошту сам; людина з акаунтом лише дозволяє відповісти на свою
    email = serializers.EmailField(required=False, allow_blank=True, default='')
    reply_to_account = serializers.BooleanField(required=False, default=False)
    discussion = serializers.UUIDField(required=False, allow_null=True, default=None)
    message = serializers.UUIDField(required=False, allow_null=True, default=None)
    context = serializers.JSONField(required=False, default=dict)
    # пастка для ботів: людина цього поля не бачить
    website = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_description(self, value):
        value = value.strip()
        if len(value) < DESCRIPTION_MIN:
            raise serializers.ValidationError(L(
                f'Опишіть, будь ласка, трохи докладніше — хоча б {DESCRIPTION_MIN} символів.',
                f'Please describe it in a bit more detail — at least {DESCRIPTION_MIN} characters.',
            ))
        return value

    def validate(self, attrs):
        user = self.context['request'].user
        signed_in = bool(user and user.is_authenticated)
        attrs['context'] = clean_context(attrs.get('context'))
        attrs['page'] = clean_page(attrs.get('page'))

        # дискусію й репліку можна додати лише свої
        discussion = None
        if attrs.get('discussion') and signed_in:
            discussion = Discussion.objects.filter(pk=attrs['discussion'], user=user).first()
        attrs['discussion'] = discussion
        message = None
        if attrs.get('message') and discussion is not None:
            message = Message.objects.filter(pk=attrs['message'], discussion=discussion).first()
        attrs['message'] = message

        if signed_in:
            attrs['email'] = user.email if attrs.get('reply_to_account') else ''
        return attrs
