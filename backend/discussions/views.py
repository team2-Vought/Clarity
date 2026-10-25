import logging
import uuid
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db.models import Count, OuterRef, Subquery
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .account_settings import preferences_of
from .models import Discussion, Message, Team
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
    SharedDiscussionSerializer,
    TeamSerializer,
    UpdateDiscussionSerializer,
)
from .services import engine, runner, search, usage
from .services.catalog import catalog, user_context

logger = logging.getLogger(__name__)


class UserModelsMixin:
    """Каталог моделей у запиті бачить власні ключі й вибір користувача."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self._user_context = user_context(request.user)
        self._user_context.__enter__()

    def finalize_response(self, request, response, *args, **kwargs):
        context = getattr(self, '_user_context', None)
        if context is not None:
            self._user_context = None
            context.__exit__(None, None, None)
        return super().finalize_response(request, response, *args, **kwargs)


def _retry_after_seconds():
    now = timezone.localtime()
    tomorrow = datetime.combine(now.date() + timedelta(days=1), time.min)
    tomorrow = timezone.make_aware(tomorrow, timezone.get_current_timezone())
    return max(1, int((tomorrow - now).total_seconds()))


TEAMS_MAX = 20
# зміна моделей під час кроку зламала б його; закріплення й архів — ні
MODEL_FIELDS = {'personas', 'moderator_model', 'devil_model'}
HISTORY_PAGE_SIZE = 30
HISTORY_PAGE_MAX = 100
SEARCH_QUERY_MAX = 200


def _int_param(request, name, default):
    try:
        return max(0, int(request.query_params.get(name, default)))
    except (TypeError, ValueError):
        return default


def _matching_ids(queryset, query):
    """Пошук у запитанні й рішенні без урахування регістру.

    LIKE у SQLite ігнорує регістр лише для латиниці, тож «чи» не знайшло б
    «Чи». Дискусій у користувача небагато (денний ліміт), тому порівнюємо
    casefold у Python.
    """
    needle = query.casefold()
    ids = []
    for pk, question, summary in queryset.values_list('pk', 'question', 'final_summary'):
        decision = summary.get('decision', '') if isinstance(summary, dict) else ''
        if needle in (question or '').casefold() or needle in str(decision).casefold():
            ids.append(pk)
    return ids


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


class FreeModelListView(UserModelsMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # параметри нової дискусії з «Налаштувань» — одним запитом з моделями
        payload = {**catalog(), 'preferences': preferences_of(request.user)}
        return Response(payload, status=status.HTTP_200_OK)


class DiscussionListCreateView(UserModelsMixin, APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'discussion_create'

    def get_throttles(self):
        # ліміт створення не має гальмувати перегляд історії
        if self.request.method != 'POST':
            return [throttle() for throttle in api_settings.DEFAULT_THROTTLE_CLASSES]
        return super().get_throttles()

    def get(self, request):
        # остання репліка учасників — прев'ю для дискусій, що ще не мають рішення
        last_reply = (
            Message.objects.filter(discussion=OuterRef('pk'))
            .exclude(role__in=[Message.Role.USER, Message.Role.RESEARCH])
            .order_by('-seq')
            .values('content')[:1]
        )
        archived = request.query_params.get('archived', '') in {'1', 'true'}
        queryset = Discussion.objects.filter(user=request.user, archived=archived)
        status_filter = request.query_params.get('status', '')
        if status_filter in Discussion.Status.values:
            queryset = queryset.filter(status=status_filter)
        query = ' '.join(request.query_params.get('q', '').split())[:SEARCH_QUERY_MAX]
        if query:
            queryset = queryset.filter(pk__in=_matching_ids(queryset, query))
        offset = _int_param(request, 'offset', 0)
        limit = min(_int_param(request, 'limit', HISTORY_PAGE_SIZE) or HISTORY_PAGE_SIZE, HISTORY_PAGE_MAX)
        total = queryset.count()
        page = (
            queryset.annotate(message_count=Count('messages'), last_reply=Subquery(last_reply))
            .order_by('-pinned', '-created_at')[offset:offset + limit]
        )
        serializer = DiscussionListSerializer(page, many=True)
        next_offset = offset + limit if offset + limit < total else None
        return Response(
            {'results': serializer.data, 'total': total, 'next_offset': next_offset},
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        if usage.over_discussion_limit(request.user):
            limit = int(settings.DISCUSSION_DAILY_LIMIT)
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
            # навіть з пошуком дискусія одразу починається з вступу:
            # учасники шукають самі, коли їм бракує фактів
            phase=Discussion.Phase.OPENING,
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
        usage.record(request.user.pk, discussions=1)
        return Response(
            DiscussionSerializer(discussion).data,
            status=status.HTTP_201_CREATED,
        )


class OwnedDiscussionView(UserModelsMixin, APIView):
    """Доступ до власної дискусії. Методи визначає кожен підклас сам:
    дії (/run/, /stop/…) не мають успадковувати GET, PATCH чи DELETE."""

    permission_classes = [IsAuthenticated]

    def get_discussion(self, request, pk):
        return Discussion.objects.filter(user=request.user, pk=pk).first()


class DiscussionDetailView(OwnedDiscussionView):
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
        changes_models = bool(MODEL_FIELDS & set(request.data))
        if changes_models and (engine.is_running(discussion) or runner.is_active(discussion.pk)):
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


class DiscussionAdvanceView(OwnedDiscussionView):
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


class DiscussionRunView(OwnedDiscussionView):
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


class DiscussionStopView(OwnedDiscussionView):
    """Зупинка після поточного кроку: за нього вже заплачено, результат збережеться."""

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        Discussion.objects.filter(pk=discussion.pk).update(stop_requested=True)
        discussion.refresh_from_db()
        return Response(_discussion_state(discussion), status=status.HTTP_200_OK)


class DiscussionMessageView(OwnedDiscussionView):
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


class DiscussionShareView(OwnedDiscussionView):
    """Публічне посилання лише для читання: POST вмикає, DELETE відкликає."""

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        if discussion.share_token is None:
            discussion.share_token = uuid.uuid4()
            discussion.save(update_fields=['share_token', 'updated_at'])
        return Response({'share_token': discussion.share_token}, status=status.HTTP_200_OK)

    def delete(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        # новий токен при наступному вмиканні: старе посилання більше не відкриється
        Discussion.objects.filter(pk=discussion.pk).update(share_token=None)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SharedDiscussionView(APIView):
    """Перегляд дискусії за публічним посиланням без входу."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token):
        discussion = Discussion.objects.filter(share_token=token).first()
        if discussion is None:
            return Response(
                {'detail': 'Посилання недійсне або доступ до дискусії закрито'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(SharedDiscussionSerializer(discussion).data, status=status.HTTP_200_OK)


class TeamListCreateView(UserModelsMixin, APIView):
    """Збережені команди. POST з наявною назвою оновлює команду, а не дублює її."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        teams = Team.objects.filter(user=request.user)
        return Response({'results': TeamSerializer(teams, many=True).data}, status=status.HTTP_200_OK)

    def post(self, request):
        serializer = TeamSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        name = serializer.validated_data['name']
        existing = Team.objects.filter(user=request.user, name=name).first()
        if existing is None and Team.objects.filter(user=request.user).count() >= TEAMS_MAX:
            return Response(
                {'detail': f'Можна зберегти не більше {TEAMS_MAX} команд. Видаліть непотрібні.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if existing is None:
            team = serializer.save(user=request.user)
            code = status.HTTP_201_CREATED
        else:
            team = serializer.update(existing, serializer.validated_data)
            code = status.HTTP_200_OK
        return Response(TeamSerializer(team).data, status=code)


class TeamDetailView(UserModelsMixin, APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        deleted, _ = Team.objects.filter(user=request.user, pk=pk).delete()
        if not deleted:
            return Response({'detail': 'Команду не знайдено'}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
