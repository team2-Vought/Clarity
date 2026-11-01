"""Завантаження вкладень до питання: файл → текст, який побачать учасники."""

from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from backend.i18n import L

from .models import Attachment
from .services import usage
from .services.attachments import NAME_MAX, AttachmentError, extension_of, extract, IMAGE_TYPES
from .services.catalog import paid_by_user, user_context, vision_model_ids

PREVIEW_CHARS = 160


def attachment_payload(attachment):
    """Що бачить інтерфейс: назва, тип і початок тексту — без самого документа."""
    return {
        'id': attachment.id,
        'name': attachment.name,
        'kind': attachment.kind,
        'size': attachment.size,
        'chars': len(attachment.text),
        'truncated': attachment.truncated,
        'preview': attachment.text[:PREVIEW_CHARS],
    }


class AttachmentUploadView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'attachments'

    def post(self, request):
        upload = request.FILES.get('file')
        if upload is None:
            return Response(
                {'detail': L('Додайте файл', 'Add a file')}, status=status.HTTP_400_BAD_REQUEST
            )
        # вкладення, що так і не потрапили в дискусію, довго не тримаємо
        Attachment.objects.filter(
            user=request.user,
            discussion__isnull=True,
            created_at__lt=timezone.now() - timedelta(days=1),
        ).delete()
        # файли без дискусії не рахуються в жоден ліміт дискусії — обмежуємо їх окремо
        pending = Attachment.objects.filter(user=request.user, discussion__isnull=True).count()
        if pending >= settings.ATTACHMENTS_PENDING_MAX:
            return Response(
                {'detail': L(
                    'Забагато файлів, що ще не додані до питання. Приберіть зайві або надішліть питання.',
                    'Too many files not yet added to a question. Remove some or send the question.',
                ), 'code': 'attachments_pending'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        is_image = extension_of(upload.name) in IMAGE_TYPES
        # фото читає модель; першою береться модель на власному ключі — тоді без ліміту
        with user_context(request.user):
            vision = vision_model_ids() if is_image else []
            server_paid = is_image and not (vision and paid_by_user(vision[0]))
        if server_paid and usage.over_reply_limit(request.user):
            return Response(
                {'detail': L(
                    'Денний ліміт AI-відповідей вичерпано — фото прочитати не вийде. PDF і текст працюють.',
                    'The daily limit of AI replies has been reached — the photo cannot be read. PDF and text work.',
                ), 'code': 'daily_limit'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        data = upload.read(settings.ATTACHMENTS_MAX_BYTES + 1)
        try:
            with user_context(request.user):
                kind, text, truncated = extract(upload.name, data)
        except AttachmentError as exc:
            return Response({'detail': exc.public, 'code': exc.code}, status=status.HTTP_400_BAD_REQUEST)
        if kind == 'image' and server_paid:
            # фото читає модель за рахунок сервера — це така сама AI-відповідь, як репліка
            usage.record(request.user.pk, replies=1)
        attachment = Attachment.objects.create(
            user=request.user,
            name=upload.name[:NAME_MAX],
            kind=kind,
            size=len(data),
            text=text,
            truncated=truncated,
        )
        return Response(attachment_payload(attachment), status=status.HTTP_201_CREATED)


class AttachmentDetailView(APIView):
    """Прибрати вкладення, яке ще не потрапило в дискусію."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        deleted, _ = Attachment.objects.filter(
            user=request.user, pk=pk, discussion__isnull=True
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT if deleted else status.HTTP_404_NOT_FOUND)
