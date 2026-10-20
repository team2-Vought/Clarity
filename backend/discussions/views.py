import logging
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db.models import Count
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import Discussion, Message
from .personas import (
    DEVIL,
    MAX_AI,
    MAX_ROUNDS,
    MIN_AI,
    PERSONAS,
    persona_public,
)
from .serializers import (
    CreateDiscussionSerializer,
    DiscussionListSerializer,
    DiscussionSerializer,
    MessageSerializer,
)
from .services import engine
from .services.catalog import catalog

logger = logging.getLogger(__name__)


def _retry_after_seconds():
    now = timezone.localtime()
    tomorrow = datetime.combine(now.date() + timedelta(days=1), time.min)
    tomorrow = timezone.make_aware(tomorrow, timezone.get_current_timezone())
    return max(1, int((tomorrow - now).total_seconds()))


def _discussion_state(discussion):
    return {
        'id': discussion.id,
        'status': discussion.status,
        'phase': discussion.phase,
        'current_round': discussion.current_round,
        'speaker_index': discussion.speaker_index,
        'early_stop': discussion.early_stop,
        'is_finished': discussion.is_finished,
        'best_solution': discussion.best_solution,
        'devil_review': discussion.devil_review,
        'final_summary': discussion.final_summary,
    }


def _too_many(message):
    return Response(
        {'detail': message},
        status=status.HTTP_429_TOO_MANY_REQUESTS,
        headers={'Retry-After': str(_retry_after_seconds())},
    )


class PersonaListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                'min_ai': MIN_AI,
                'max_ai': MAX_AI,
                'max_rounds': MAX_ROUNDS,
                'personas': [persona_public(p) for p in PERSONAS],
                'devil': persona_public(DEVIL),
                'modes': [
                    {'value': value, 'label': label}
                    for value, label in Discussion.Mode.choices
                ],
            },
            status=status.HTTP_200_OK,
        )


class FreeModelListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(catalog(), status=status.HTTP_200_OK)


class DiscussionListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'discussion_create'

    def get(self, request):
        queryset = (
            Discussion.objects.filter(user=request.user)
            .annotate(message_count=Count('messages'))
            .order_by('-created_at')[:50]
        )
        serializer = DiscussionListSerializer(queryset, many=True)
        return Response({'results': serializer.data}, status=status.HTTP_200_OK)

    def post(self, request):
        limit = int(getattr(settings, 'DISCUSSION_DAILY_LIMIT', 0) or 0)
        if limit:
            today = timezone.localdate()
            created_today = Discussion.objects.filter(
                user=request.user,
                created_at__date=today,
            ).count()
            if created_today >= limit:
                return _too_many(
                    f'Денний ліміт створення дискусій вичерпано ({limit}). '
                    'Спробуйте завтра.'
                )

        serializer = CreateDiscussionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        discussion = Discussion.objects.create(
            user=request.user,
            question=data['question'],
            mode=data.get('mode', Discussion.Mode.OPEN),
            options=data.get('options') or [],
            personas=data['personas'],
            rounds=data['rounds'],
        )
        # одразу створюємо повідомлення користувача як початок чату
        discussion.messages.create(
            seq=1,
            phase=Discussion.Phase.OPENING,
            role='user',
            persona_slug='user',
            persona_name=request.user.name or 'Користувач',
            avatar='🧑',
            content=discussion.question,
        )
        return Response(
            DiscussionSerializer(discussion).data,
            status=status.HTTP_201_CREATED,
        )


class DiscussionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_discussion(self, request, pk):
        return Discussion.objects.filter(user=request.user, pk=pk).first()

    def get(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return Response(
                {'detail': 'Дискусію не знайдено'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(DiscussionSerializer(discussion).data, status=status.HTTP_200_OK)

    def delete(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return Response(
                {'detail': 'Дискусію не знайдено'},
                status=status.HTTP_404_NOT_FOUND,
            )
        discussion.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DiscussionAdvanceView(DiscussionDetailView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'discussion_advance'

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return Response(
                {'detail': 'Дискусію не знайдено'},
                status=status.HTTP_404_NOT_FOUND,
            )

        limit = int(getattr(settings, 'DISCUSSION_DAILY_ADVANCE_LIMIT', 0) or 0)
        if limit:
            used_today = Message.objects.filter(
                discussion__user=request.user,
                role=Message.Role.AI,
                created_at__date=timezone.localdate(),
            ).count()
            if used_today >= limit:
                return _too_many(
                    f'Денний ліміт AI-відповідей вичерпано ({limit}). '
                    'Спробуйте завтра.'
                )

        try:
            messages = engine.advance(discussion)
        except engine.EngineBusy:
            return Response(
                {'detail': 'Ця дискусія вже обробляється. Спробуйте за мить.'},
                status=status.HTTP_409_CONFLICT,
                headers={'Retry-After': '2'},
            )
        except engine.EngineConflict:
            discussion.refresh_from_db()
            return Response(
                {
                    'detail': 'Стан дискусії змінився. Оновіть сторінку.',
                    'status': discussion.status,
                    'phase': discussion.phase,
                },
                status=status.HTTP_409_CONFLICT,
            )
        except engine.EngineError:
            logger.exception('Помилка кроку дискусії %s', discussion.pk)
            discussion.refresh_from_db()
            return Response(
                {
                    'detail': 'Не вдалося отримати відповідь від AI. Спробуйте ще раз.',
                    'status': discussion.status,
                    'phase': discussion.phase,
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

        discussion.refresh_from_db()
        serialized = MessageSerializer(messages, many=True).data
        payload = {
            'discussion': _discussion_state(discussion),
            'messages': serialized,
            # сумісність зі старим клієнтом: останнє створене повідомлення
            'message': serialized[-1] if serialized else None,
        }
        return Response(payload, status=status.HTTP_200_OK)
