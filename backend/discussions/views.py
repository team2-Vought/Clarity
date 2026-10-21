import logging
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db.models import Count, OuterRef, Subquery
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
    NON_RETRYABLE_CODES,
    CreateDiscussionSerializer,
    DiscussionListSerializer,
    DiscussionSerializer,
    MessageSerializer,
    UpdateDiscussionSerializer,
)
from .services import engine, runner, search
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
        'rounds': discussion.rounds,
        'stop_requested': discussion.stop_requested,
        'is_running': engine.is_running(discussion) or runner.is_active(discussion.pk),
        'error_code': discussion.error_code,
        'error_public': discussion.error_public,
        'retryable': discussion.error_code not in NON_RETRYABLE_CODES,
        'sources': discussion.sources,
        'followups': discussion.followups,
        'best_solution': discussion.best_solution,
        'devil_review': discussion.devil_review,
        'final_summary': discussion.final_summary,
    }


def _daily_limit_response():
    limit = int(getattr(settings, 'DISCUSSION_DAILY_ADVANCE_LIMIT', 0) or 0)
    return _too_many(
        f'Денний ліміт AI-відповідей вичерпано ({limit}). Спробуйте завтра.'
    )


def _not_found():
    return Response(
        {'detail': 'Дискусію не знайдено'},
        status=status.HTTP_404_NOT_FOUND,
    )


def _engine_error_response(exc, discussion=None):
    payload = {
        'detail': exc.public or engine.GENERIC_PUBLIC_ERROR,
        'code': exc.code,
        'retryable': exc.retryable and exc.code not in NON_RETRYABLE_CODES,
    }
    if discussion is not None:
        payload.update({'status': discussion.status, 'phase': discussion.phase})
    return Response(payload, status=status.HTTP_502_BAD_GATEWAY)


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
                'search': search.status(),
                'max_followups': int(settings.DISCUSSION_MAX_FOLLOWUPS),
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
        # остання репліка учасників — прев'ю для дискусій, що ще не мають рішення
        last_reply = (
            Message.objects.filter(discussion=OuterRef('pk'))
            .exclude(role__in=[Message.Role.USER, Message.Role.RESEARCH])
            .order_by('-seq')
            .values('content')[:1]
        )
        queryset = (
            Discussion.objects.filter(user=request.user)
            .annotate(message_count=Count('messages'), last_reply=Subquery(last_reply))
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
            web_search=data.get('web_search', False),
            moderator_model=data.get('moderator_model', ''),
            devil_model=data.get('devil_model', ''),
            phase=(
                Discussion.Phase.RESEARCH
                if data.get('web_search')
                else Discussion.Phase.OPENING
            ),
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
            return _not_found()
        context = {}
        after = request.query_params.get('after')
        if after is not None:
            try:
                context['after'] = max(0, int(after))
            except ValueError:
                pass
        return Response(
            DiscussionSerializer(discussion, context=context).data,
            status=status.HTTP_200_OK,
        )

    def patch(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        if engine.is_running(discussion) or runner.is_active(discussion.pk):
            return Response(
                {'detail': 'Зачекайте, поки завершиться поточний крок, або зупиніть дискусію.'},
                status=status.HTTP_409_CONFLICT,
            )
        serializer = UpdateDiscussionSerializer(discussion, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        discussion.refresh_from_db()
        return Response(DiscussionSerializer(discussion).data, status=status.HTTP_200_OK)

    def delete(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        Discussion.objects.filter(pk=discussion.pk).update(stop_requested=True)
        discussion.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DiscussionAdvanceView(DiscussionDetailView):
    """Один синхронний крок (сумісність і тести). UI користується /run."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'discussion_advance'

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        if runner.over_daily_limit(request.user):
            return _daily_limit_response()

        try:
            messages = engine.advance(discussion)
        except engine.EngineBusy:
            return Response(
                {'detail': 'Ця дискусія вже обробляється. Спробуйте за мить.', 'code': 'busy'},
                status=status.HTTP_409_CONFLICT,
                headers={'Retry-After': '2'},
            )
        except engine.EngineConflict:
            discussion.refresh_from_db()
            return Response(
                {
                    'detail': 'Стан дискусії змінився. Оновіть сторінку.',
                    'code': 'conflict',
                    'status': discussion.status,
                    'phase': discussion.phase,
                },
                status=status.HTTP_409_CONFLICT,
            )
        except engine.EngineError as exc:
            logger.exception('Помилка кроку дискусії %s', discussion.pk)
            discussion.refresh_from_db()
            return _engine_error_response(exc, discussion)

        discussion.refresh_from_db()
        serialized = MessageSerializer(messages, many=True).data
        payload = {
            'discussion': _discussion_state(discussion),
            'messages': serialized,
            # сумісність зі старим клієнтом: останнє створене повідомлення
            'message': serialized[-1] if serialized else None,
        }
        return Response(payload, status=status.HTTP_200_OK)


class DiscussionRunView(DiscussionDetailView):
    """Запускає фонове виконання дискусії; клієнт далі лише опитує стан."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'discussion_advance'

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        if discussion.phase != Discussion.Phase.DONE:
            if runner.over_daily_limit(request.user):
                return _daily_limit_response()
            Discussion.objects.filter(pk=discussion.pk).update(stop_requested=False)
            runner.start(discussion.pk)
        discussion.refresh_from_db()
        return Response(_discussion_state(discussion), status=status.HTTP_202_ACCEPTED)


class DiscussionStopView(DiscussionDetailView):
    """Зупинка після поточного кроку: за нього вже заплачено, результат збережеться."""

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        Discussion.objects.filter(pk=discussion.pk).update(stop_requested=True)
        discussion.refresh_from_db()
        return Response(_discussion_state(discussion), status=status.HTTP_200_OK)


class DiscussionMessageView(DiscussionDetailView):
    """Уточнення користувача під час дискусії або після фіналу."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'discussion_note'

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        if runner.over_daily_limit(request.user):
            return _daily_limit_response()
        try:
            message, reopened = engine.add_user_message(
                discussion.pk,
                request.user.name or 'Користувач',
                request.data.get('content', ''),
            )
        except engine.EngineError as exc:
            return Response(
                {'detail': exc.public or engine.GENERIC_PUBLIC_ERROR, 'code': exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )
        runner.start(discussion.pk)
        discussion.refresh_from_db()
        return Response(
            {
                'message': MessageSerializer(message).data,
                'reopened': reopened,
                'discussion': _discussion_state(discussion),
            },
            status=status.HTTP_201_CREATED,
        )
