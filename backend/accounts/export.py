"""Експорт усіх даних людини одним JSON-файлом (право на доступ і перенесення, GDPR ст. 15 і 20).

Секретів у файлі немає: замість власних API-ключів — лише провайдер і
скорочений ключ, замість входів на пристроях — дата й пристрій без ключа.
"""

from django.db.models import F
from django.utils import timezone

from discussions.models import (
    Attachment,
    CustomPersona,
    DailyUsage,
    Decision,
    Discussion,
    Highlight,
    Message,
    Team,
)
from support.models import BugReport

from .models import AuthToken, ProviderKey

FORMAT_VERSION = 1

DISCUSSION_FIELDS = [
    'id', 'question', 'language', 'mode', 'options', 'personas', 'rounds', 'until_consensus',
    'web_search', 'moderator_model', 'devil_model', 'profile', 'clarifications', 'criteria',
    'matrix', 'scores', 'sources', 'best_solution', 'devil_review', 'final_summary', 'feedback',
    'feedback_note', 'safety', 'quick', 'status', 'phase', 'pinned', 'archived', 'share_token',
    'share_personal', 'created_at', 'finished_at',
]
MESSAGE_FIELDS = [
    'seq', 'phase', 'role', 'persona_slug', 'persona_name', 'round', 'stance', 'content',
    'model_id', 'reaction', 'created_at',
]


def _rows(queryset, fields):
    names = {field.attname for field in queryset.model._meta.concrete_fields}
    return list(queryset.values(*[name for name in fields if name in names]))


def _all_fields(queryset, exclude=('user',)):
    fields = [
        field.attname if field.is_relation else field.name
        for field in queryset.model._meta.concrete_fields
        if field.name not in exclude
    ]
    return list(queryset.values(*fields))


def export_user(user):
    messages = {}
    for row in _rows(
        Message.objects.filter(discussion__user=user).order_by('discussion_id', 'seq'),
        ['discussion_id', *MESSAGE_FIELDS],
    ):
        messages.setdefault(row.pop('discussion_id'), []).append(row)
    discussions = _rows(Discussion.objects.filter(user=user).order_by('created_at'), DISCUSSION_FIELDS)
    for discussion in discussions:
        discussion['messages'] = messages.get(discussion['id'], [])
    return {
        'format': 'clarity-export',
        'version': FORMAT_VERSION,
        'exported_at': timezone.now(),
        'account': {
            'name': user.name,
            'email': user.email,
            'email_verified': user.email_verified,
            'date_joined': user.date_joined,
            'last_login': user.last_login,
            'has_password': user.has_usable_password(),
            'avatar': user.avatar,
            'about': user.about,
            'preferences': user.preferences,
        },
        'api_keys': list(
            ProviderKey.objects.filter(user=user).values('provider', 'masked', 'created_at', 'updated_at')
        ),
        'sessions': list(
            AuthToken.objects.filter(user=user).values('label', 'created_at', 'last_used_at', 'expires_at')
        ),
        'discussions': discussions,
        'attachments': _all_fields(Attachment.objects.filter(user=user).order_by('created_at')),
        'journal': _all_fields(Decision.objects.filter(user=user).order_by('created_at')),
        'teams': _all_fields(Team.objects.filter(user=user)),
        'custom_roles': _all_fields(CustomPersona.objects.filter(user=user)),
        'daily_usage': _all_fields(DailyUsage.objects.filter(user=user).order_by('date')),
        # виділені фрагменти реплік із нотатками; message_seq — номер репліки в дискусії
        'highlights': list(
            Highlight.objects.filter(message__discussion__user=user)
            .order_by('created_at')
            .values(
                'quote', 'color', 'note', 'created_at',
                discussion_id=F('message__discussion_id'), message_seq=F('message__seq'),
            )
        ),
        'bug_reports': list(
            BugReport.objects.filter(user=user)
            .order_by('created_at')
            .values('kind', 'description', 'contact_email', 'page', 'status', 'created_at')
        ),
    }
