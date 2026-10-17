from django.db.models import Count
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import Discussion
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

        try:
            message = engine.advance(discussion)
        except engine.EngineError as exc:
            discussion.refresh_from_db()
            return Response(
                {
                    'detail': str(exc),
                    'status': discussion.status,
                    'phase': discussion.phase,
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

        discussion.refresh_from_db()
        payload = {
            'discussion': {
                'id': discussion.id,
                'status': discussion.status,
                'phase': discussion.phase,
                'current_round': discussion.current_round,
                'is_finished': discussion.is_finished,
            },
            'message': MessageSerializer(message).data if message else None,
        }
        return Response(payload, status=status.HTTP_200_OK)
