import logging
import uuid
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Count, OuterRef, Subquery
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.about import about_of
from accounts.about import snapshot as about_snapshot
from backend.i18n import L, current

from .account_settings import preferences_of
from .models import Attachment, CustomPersona, Discussion, Message, Team
from .personas import (
    CONSENSUS_MAX_ROUNDS,
    DEVIL,
    MAX_AI,
    MODE_LABELS_EN,
    MAX_ROUNDS,
    MIN_AI,
    MIN_ROUNDS,
    PERSONAS,
    custom_public,
    persona_public,
)
from .serializers import (
    NON_RETRYABLE_CODES,
    CustomPersonaSerializer,
    FeedbackSerializer,
    ClarifyAnswersSerializer,
    CreateDiscussionSerializer,
    DiscussionListSerializer,
    DiscussionSerializer,
    MessageCreateSerializer,
    MessageSerializer,
    SharedDiscussionSerializer,
    TeamSerializer,
    UpdateDiscussionSerializer,
)
from .services import engine, runner, search, usage
from .services.safety import looks_like_crisis
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
        'finished_early': discussion.finished_early,
        'is_finished': discussion.is_finished,
        'rounds': discussion.rounds,
        'until_consensus': discussion.until_consensus,
        'stop_requested': discussion.stop_requested,
        'clarify_questions': discussion.clarify_questions,
        'is_running': runner.is_working(discussion),
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
    return _too_many(runner.daily_limit_message())


def _not_found():
    return Response(
        {'detail': L('Дискусію не знайдено', 'Discussion not found')},
        status=status.HTTP_404_NOT_FOUND,
    )


def _engine_error_response(exc, discussion=None):
    payload = {
        'detail': exc.public or engine.generic_public_error(),
        'code': exc.code,
        'retryable': exc.retryable and exc.code not in NON_RETRYABLE_CODES,
    }
    if discussion is not None:
        payload.update({'status': discussion.status, 'phase': discussion.phase})
    if exc.code == 'daily_limit':
        # крок не вмістився в ліміт ще до виклику моделей — це не збій провайдера
        return Response(
            payload,
            status=status.HTTP_429_TOO_MANY_REQUESTS,
            headers={'Retry-After': str(_retry_after_seconds())},
        )
    return Response(payload, status=status.HTTP_502_BAD_GATEWAY)


def _too_many(message):
    return Response(
        {'detail': message},
        status=status.HTTP_429_TOO_MANY_REQUESTS,
        headers={'Retry-After': str(_retry_after_seconds())},
    )


def _discussion_limit_response(own_key_hint=True):
    limit = int(settings.DISCUSSION_DAILY_LIMIT)
    if own_key_hint:
        return _too_many(L(
            f'Денний ліміт створення дискусій вичерпано ({limit}). '
            'Спробуйте завтра або додайте власний API-ключ — з ним ліміту немає.',
            f'The daily limit of new discussions has been reached ({limit}). '
            'Try again tomorrow or add your own API key — there is no limit with it.',
        ))
    return _too_many(L(
        f'Денний ліміт створення дискусій вичерпано ({limit}). Спробуйте завтра.',
        f'The daily limit of new discussions has been reached ({limit}). Try again tomorrow.',
    ))


def _count_toward_limit(discussion):
    """Зараховує дискусію в денний ліміт нових, щойно за неї платитиме сервер.

    Дискусія лише на власних ключах слоту не займала. Але моделі можна змінити
    (PATCH) чи видалити ключ — тоді вона йде на серверних, і слот списуємо тут.
    Кризову не рахуємо: вона моделей не кличе. None — можна працювати далі,
    інакше — відповідь 429."""
    if discussion.limit_counted or discussion.safety == Discussion.Safety.CRISIS:
        return None
    with user_context(discussion.user):
        if engine.billing(discussion) == engine.context.OWN:
            return None
    if usage.over_discussion_limit(discussion.user):
        return _discussion_limit_response()
    # умовний UPDATE: паралельні запити не спишуть слот двічі
    if Discussion.objects.filter(pk=discussion.pk, limit_counted=False).update(limit_counted=True):
        usage.record(discussion.user_id, discussions=1)
    discussion.limit_counted = True
    return None


class PersonaListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                'min_ai': MIN_AI,
                'max_ai': MAX_AI,
                'min_rounds': MIN_ROUNDS,
                'max_rounds': MAX_ROUNDS,
                'consensus_max_rounds': CONSENSUS_MAX_ROUNDS,
                'personas': [persona_public(p) for p in PERSONAS],
                # свої ролі людини — у тому ж вигляді, що й вбудовані
                'custom': [custom_public(role) for role in CustomPersona.objects.filter(user=request.user)],
                'devil': persona_public(DEVIL),
                'search': search.status(),
                'max_followups': int(settings.DISCUSSION_MAX_FOLLOWUPS),
                'modes': [
                    {'value': value, 'label': L(label, MODE_LABELS_EN.get(value, label))}
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
        serializer = CreateDiscussionSerializer(data=request.data, context={'user': request.user})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # дискусія лише на власних ключах людини не впирається в денний ліміт:
        # за її виклики платить вона сама, а не сервер
        draft = Discussion(
            user=request.user,
            personas=data['personas'],
            moderator_model=data.get('moderator_model', ''),
            devil_model=data.get('devil_model', ''),
        )
        with user_context(request.user):
            own_keys = engine.billing(draft) == engine.context.OWN
        crisis_by_words = not data['not_crisis'] and looks_like_crisis(data['question'])
        counted = not crisis_by_words and not own_keys
        # людина в кризі бачить допомогу навіть тоді, коли ліміт дискусій вичерпано:
        # моделей така дискусія не кличе
        if counted and usage.over_discussion_limit(request.user):
            return _discussion_limit_response()
        about = about_of(request.user)
        use_profile = data.get('use_profile', about['enabled'])
        quick = data.get('quick', False)
        discussion = Discussion.objects.create(
            user=request.user,
            question=data['question'],
            profile=about_snapshot(about) if use_profile else {},
            mode=data.get('mode', Discussion.Mode.OPEN),
            options=data.get('options') or [],
            personas=data['personas'],
            rounds=CONSENSUS_MAX_ROUNDS if data['until_consensus'] else data['rounds'],
            until_consensus=data['until_consensus'],
            web_search=data.get('web_search', False),
            moderator_model=data.get('moderator_model', ''),
            devil_model=data.get('devil_model', ''),
            # спершу модератор перевіряє, чи досить контексту; пошуку окремим
            # кроком немає — учасники шукають самі, коли їм бракує фактів
            # швидкий режим одразу дає коротку відповідь, без перевірки контексту й дебатів
            phase=Discussion.Phase.QUICK if quick else Discussion.Phase.CLARIFY,
            quick=quick,
            criteria=data.get('criteria') or [],
            # криза видна з самого питання — дискусія не запуститься, людина побачить допомогу
            safety=Discussion.Safety.CRISIS if crisis_by_words else '',
            crisis_dismissed=data['not_crisis'],
            limit_counted=counted,
            # мова інтерфейсу автора: нею відповідатимуть AI
            language=current(),
        )
        # вкладення людини, що ще ні до чого не прив'язані, стають частиною питання
        Attachment.objects.filter(
            user=request.user, pk__in=data['attachments'], discussion__isnull=True
        ).update(discussion=discussion)
        # одразу створюємо повідомлення користувача як початок чату
        discussion.messages.create(
            seq=1,
            phase=Discussion.Phase.OPENING,
            role='user',
            persona_slug='user',
            persona_name=request.user.name or L('Користувач', 'User'),
            avatar='🧑',
            content=discussion.question,
        )
        # кризова дискусія не запускається й моделей не кличе — слот ліміту не витрачає;
        # його спишемо, якщо людина скаже «Я питаю про інше» (_count_toward_limit)
        if counted:
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
        if changes_models and runner.is_working(discussion):
            return Response(
                {'detail': L(
                    'Зачекайте, поки завершиться поточний крок, або зупиніть дискусію.',
                    'Wait for the current step to finish or stop the discussion.',
                )},
                status=status.HTTP_409_CONFLICT,
            )
        serializer = UpdateDiscussionSerializer(discussion, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            serializer.save()
            discussion.refresh_from_db()
            # перехід із власних ключів на серверні моделі займає слот денного ліміту;
            # якщо слотів немає — зміну моделей відкочуємо
            limited = _count_toward_limit(discussion) if changes_models else None
            if limited is not None:
                transaction.set_rollback(True)
        if limited is not None:
            return limited
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
        if runner.over_daily_limit(request.user, discussion):
            return _daily_limit_response()

        try:
            messages = engine.advance(discussion)
        except engine.EngineBusy:
            return Response(
                {
                    'detail': L(
                        'Ця дискусія вже обробляється. Спробуйте за мить.',
                        'This discussion is already being processed. Try again in a moment.',
                    ),
                    'code': 'busy',
                },
                status=status.HTTP_409_CONFLICT,
                headers={'Retry-After': '2'},
            )
        except engine.EngineConflict:
            discussion.refresh_from_db()
            return Response(
                {
                    'detail': L(
                        'Стан дискусії змінився. Оновіть сторінку.',
                        'The discussion has changed. Refresh the page.',
                    ),
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
            if runner.over_daily_limit(request.user, discussion):
                return _daily_limit_response()
            # власний ключ могли видалити — тоді дискусія йде на серверних моделях
            limited = _count_toward_limit(discussion)
            if limited is not None:
                return limited
            Discussion.objects.filter(pk=discussion.pk).update(stop_requested=False)
            if not runner.start(discussion.pk) and not runner.is_active(discussion.pk):
                # режим thread: усі потоки вебсервера зайняті іншими дискусіями
                return Response(
                    {'detail': L(
                        'Сервер зараз зайнятий іншими дискусіями. Спробуйте за хвилину.',
                        'The server is busy with other discussions. Try again in a minute.',
                    ), 'code': 'busy'},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                    headers={'Retry-After': '30'},
                )
        discussion.refresh_from_db()
        return Response(_discussion_state(discussion), status=status.HTTP_202_ACCEPTED)


class DiscussionStopView(OwnedDiscussionView):
    """Негайна зупинка: lease кроку знімається, тож відповідь, яку модель ще
    пише, буде відкинута (крок не збережеться через зміну токена)."""

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        Discussion.objects.filter(pk=discussion.pk).update(
            stop_requested=True,
            advance_token=None,
            advance_started_at=None,
            live_token=None,
            run_requested_at=None,
        )
        discussion.refresh_from_db()
        return Response(_discussion_state(discussion), status=status.HTTP_200_OK)


class DiscussionNotCrisisView(OwnedDiscussionView):
    """«Я питаю про інше»: дискусію, яку зупинила криза ще до старту, запускаємо
    як звичайну. Кризу й далі може розпізнати модератор під час перевірки контексту."""

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        roles = set(discussion.messages.values_list('role', flat=True))
        started = (
            roles - {Message.Role.USER, Message.Role.MODERATOR}
            or discussion.messages.filter(role=Message.Role.USER).count() > 1
        )
        if discussion.safety != Discussion.Safety.CRISIS or not discussion.is_finished or started:
            return Response(
                {
                    'detail': L(
                        'Цю дискусію вже не можна перезапустити.',
                        'This discussion can no longer be restarted.',
                    ),
                    'code': 'not_restartable',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            # відповідь про кризу більше не стосується питання
            discussion.messages.filter(role=Message.Role.MODERATOR).delete()
            discussion.safety = ''
            # запасна (широка) ознака кризи більше не зупинить дискусію — лише модератор
            discussion.crisis_dismissed = True
            discussion.phase = Discussion.Phase.QUICK if discussion.quick else Discussion.Phase.CLARIFY
            discussion.status = Discussion.Status.NEW
            discussion.finished_at = None
            discussion.stop_requested = False
            discussion.save()
            # тепер дискусія піде до моделей: слот ліміту — якщо платить сервер
            limited = _count_toward_limit(discussion)
            if limited is not None:
                transaction.set_rollback(True)
        if limited is not None:
            return limited
        return Response(DiscussionSerializer(discussion).data, status=status.HTTP_200_OK)


class DiscussionFinishView(OwnedDiscussionView):
    """«Завершити»: дискусія обривається одразу, без висновку модератора."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'discussion_advance'

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        try:
            engine.finish_early(discussion.pk)
        except engine.EngineError as exc:
            return Response(
                {'detail': exc.public or engine.generic_public_error(), 'code': exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )
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
        if runner.over_daily_limit(request.user, discussion):
            return _daily_limit_response()
        limited = _count_toward_limit(discussion)
        if limited is not None:
            return limited
        serializer = MessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            message, reopened = engine.add_user_message(
                discussion.pk,
                request.user.name or L('Користувач', 'User'),
                request.data.get('content', ''),
                # після висновку можна звернутися до одного учасника
                target=str(request.data.get('target') or ''),
                quick=data['quick'],
                attachment_ids=data['attachments'],
            )
        except engine.EngineError as exc:
            return Response(
                {'detail': exc.public or engine.generic_public_error(), 'code': exc.code},
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


class DiscussionClarifyView(OwnedDiscussionView):
    """Відповіді на уточнювальні питання модератора; після них стартує вступ."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'discussion_clarify'

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        serializer = ClarifyAnswersSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            discussion = engine.answer_clarification(
                discussion.pk, serializer.validated_data['answers']
            )
        except engine.EngineError as exc:
            return Response(
                {'detail': exc.public or engine.generic_public_error(), 'code': exc.code},
                status=status.HTTP_409_CONFLICT,
            )
        if not runner.over_daily_limit(request.user, discussion):
            runner.start(discussion.pk)
        discussion.refresh_from_db()
        return Response(DiscussionSerializer(discussion).data, status=status.HTTP_200_OK)


class DiscussionShareView(OwnedDiscussionView):
    """Публічне посилання лише для читання: POST вмикає, DELETE відкликає."""

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        # особисте (відповіді на уточнення, інші повідомлення автора) — лише якщо
        # автор явно погодився в діалозі перед створенням посилання
        discussion.share_personal = request.data.get('personal') is True
        if discussion.share_token is None:
            discussion.share_token = uuid.uuid4()
        discussion.save(update_fields=['share_token', 'share_personal', 'updated_at'])
        return Response(
            {'share_token': discussion.share_token, 'share_personal': discussion.share_personal},
            status=status.HTTP_200_OK,
        )

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
                {'detail': L(
                    'Посилання недійсне або доступ до дискусії закрито',
                    'The link is invalid or access to the discussion has been closed',
                )},
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
        serializer = TeamSerializer(data=request.data, context={'user': request.user})
        serializer.is_valid(raise_exception=True)
        name = serializer.validated_data['name']
        existing = Team.objects.filter(user=request.user, name=name).first()
        if existing is None and Team.objects.filter(user=request.user).count() >= TEAMS_MAX:
            return Response(
                {'detail': L(
                    f'Можна зберегти не більше {TEAMS_MAX} команд. Видаліть непотрібні.',
                    f'You can save no more than {TEAMS_MAX} teams. Delete the ones you no longer need.',
                )},
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
            return Response(
                {'detail': L('Команду не знайдено', 'Team not found')},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


CUSTOM_PERSONAS_MAX = 20


class DiscussionFeedbackView(OwnedDiscussionView):
    """«Допомогло / не допомогло» під висновком — так ми знаємо, чи Clarity корисний."""

    def post(self, request, pk):
        discussion = self.get_discussion(request, pk)
        if discussion is None:
            return _not_found()
        serializer = FeedbackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        value = serializer.validated_data['value']
        Discussion.objects.filter(pk=discussion.pk).update(
            feedback=value,
            feedback_note=serializer.validated_data.get('note', '').strip() if value else '',
            feedback_at=timezone.now() if value else None,
        )
        discussion.refresh_from_db()
        return Response(
            {'feedback': discussion.feedback, 'feedback_note': discussion.feedback_note},
            status=status.HTTP_200_OK,
        )


class CustomPersonaListView(APIView):
    """Свої ролі: «юрист», «фінансовий консультант», «мій обережний тато»."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        roles = CustomPersona.objects.filter(user=request.user)
        return Response(
            {'results': CustomPersonaSerializer(roles, many=True).data}, status=status.HTTP_200_OK
        )

    def post(self, request):
        if CustomPersona.objects.filter(user=request.user).count() >= CUSTOM_PERSONAS_MAX:
            return Response(
                {'detail': L(
                    f'Можна створити не більше {CUSTOM_PERSONAS_MAX} своїх ролей.',
                    f'You can create no more than {CUSTOM_PERSONAS_MAX} roles of your own.',
                )},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = CustomPersonaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role = serializer.save(user=request.user)
        return Response(CustomPersonaSerializer(role).data, status=status.HTTP_201_CREATED)


class CustomPersonaDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        role = CustomPersona.objects.filter(user=request.user, pk=pk).first()
        if role is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        serializer = CustomPersonaSerializer(role, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request, pk):
        deleted, _ = CustomPersona.objects.filter(user=request.user, pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT if deleted else status.HTTP_404_NOT_FOUND)
