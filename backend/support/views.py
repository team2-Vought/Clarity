import logging

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from backend.i18n import current

from .models import BugReport
from .serializers import BugReportSerializer

logger = logging.getLogger(__name__)

MAIL_CONTEXT_FIELDS = ('user_agent', 'viewport', 'language', 'theme', 'vision', 'build')


def notify_team(report):
    """Лист команді про нове звернення. Не вийшло — воно однаково лишається в адмінці."""
    address = settings.BUG_REPORT_EMAIL
    if not address:
        return
    who = report.user.email if report.user else 'гість'
    lines = [
        f'#{report.reference} · {report.get_kind_display()}',
        '',
        report.description,
        '',
        f'Сторінка: {report.page or "—"}',
        f'Відповісти: {report.contact_email or "—"}',
        f'Користувач: {who}',
    ]
    if report.discussion_id:
        lines.append(f'Дискусія (з дозволу): {report.discussion_id}')
    if report.message_id:
        lines.append(f'Репліка: {report.message_id}')
    context = report.context or {}
    for name in MAIL_CONTEXT_FIELDS:
        if context.get(name):
            lines.append(f'{name}: {context[name]}')
    for error in context.get('errors', []):
        lines.append(f'! {error.get("kind", "error")}: {error.get("message", "")}')
    try:
        send_mail(
            f'[Clarity] {report.get_kind_display()} #{report.reference}',
            '\n'.join(lines),
            settings.DEFAULT_FROM_EMAIL,
            [address],
        )
    except Exception:
        logger.exception('Bug report email failed')


class BugReportView(APIView):
    """«Знайшли баги?» — звернення від людини з акаунтом чи від гостя."""

    permission_classes = [AllowAny]
    throttle_scope = 'bug_report'
    throttle_classes = [ScopedRateThrottle]

    def post(self, request):
        serializer = BugReportSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data.get('website'):
            # бот заповнив приховане поле — удаємо, що все гаразд, і нічого не зберігаємо
            return Response({'reference': 'OK'}, status=status.HTTP_201_CREATED)
        user = request.user if request.user and request.user.is_authenticated else None
        report = BugReport.objects.create(
            user=user,
            kind=data['kind'],
            description=data['description'],
            contact_email=data.get('email', ''),
            page=data['page'],
            discussion=data['discussion'],
            message=data['message'],
            context=data['context'],
            language=current(),
        )
        transaction.on_commit(lambda: notify_team(report))
        return Response({'reference': report.reference}, status=status.HTTP_201_CREATED)
