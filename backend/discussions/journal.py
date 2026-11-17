"""Журнал рішень: людина фіксує, що вирішила після дискусії, а через тиждень,
місяць чи три Clarity питає «Як воно?». Так складається історія власних
рішень і того, як вони спрацювали.
"""

from datetime import timedelta

from django.core.cache import cache
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from backend.i18n import L, lazy_L

from .models import Decision, Discussion
from .services import reminders

REMIND_CHOICES = (7, 30, 90)
DECISION_MAX = 2000
REFLECTION_MAX = 1000

NOT_FINISHED = lazy_L(
    'Зафіксувати можна лише завершену дискусію',
    'Only a finished discussion can be recorded',
)
REQUIRED = lazy_L('Це поле обов’язкове', 'This field is required')


def status_of(entry, now=None):
    """'reviewed' — підсумовано; 'due' — час спитати «Як воно?»; 'waiting' — ще рано."""
    if entry.reviewed_at:
        return 'reviewed'
    return 'due' if entry.check_at <= (now or timezone.now()) else 'waiting'


def due_entries(user, now=None):
    return Decision.objects.filter(
        user=user, reviewed_at__isnull=True, check_at__lte=now or timezone.now()
    ).order_by('check_at')


LESSONS_MAX = 5


def past_lessons(user, limit=LESSONS_MAX):
    """Підсумовані рішення людини — що вирішила, як вийшло й що зрозуміла.

    Знімок кладеться в профіль нової дискусії (`profile['history']`): модератор
    і учасники бачать, що людині вже спрацювало, а що ні. Запис без «Як вийшло»
    нічого не вчить — його не беремо.
    """
    entries = (
        Decision.objects.filter(user=user, reviewed_at__isnull=False)
        .exclude(outcome='')
        .order_by('-reviewed_at')[:limit]
    )
    return [
        {
            'question': ' '.join(entry.question.split())[:200],
            'decision': ' '.join(entry.decision.split())[:300],
            'outcome': entry.outcome,
            'reflection': ' '.join(entry.reflection.split())[:300],
        }
        for entry in entries
    ]


def journal_state(discussion):
    """Що бачить чат під підсумком: чи рішення вже в журналі й коли спитаємо."""
    entry = getattr(discussion, 'journal_entry', None)
    if entry is None:
        return None
    return {'id': entry.id, 'check_at': entry.check_at, 'status': status_of(entry)}


class DecisionSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    discussion_id = serializers.UUIDField(read_only=True)
    # «Переглянути рішення»: дискусії, що почались із цього запису, — ланцюжок рішень
    revisits = serializers.SerializerMethodField()

    class Meta:
        model = Decision
        fields = [
            'id',
            'discussion_id',
            'question',
            'decision',
            'steps',
            'done_steps',
            'triggers',
            'check_at',
            'outcome',
            'reflection',
            'reviewed_at',
            'created_at',
            'status',
            'revisits',
            'followed_advice',
        ]

    def get_status(self, obj):
        return status_of(obj)

    def get_revisits(self, obj):
        return [
            {
                'id': discussion.id,
                'created_at': discussion.created_at,
                'done': discussion.status == Discussion.Status.DONE,
                # що вирішили під час перегляду, якщо вже записали в журнал
                'decision_id': getattr(getattr(discussion, 'journal_entry', None), 'id', None),
            }
            for discussion in obj.revisits.order_by('created_at')
        ]


class CreateDecisionSerializer(serializers.Serializer):
    discussion = serializers.UUIDField()
    decision = serializers.CharField(
        max_length=DECISION_MAX,
        error_messages={'blank': REQUIRED, 'required': REQUIRED},
    )
    remind_in_days = serializers.ChoiceField(choices=REMIND_CHOICES, default=30)
    # клієнт знає, чи людина лишила підставлений висновок Clarity без змін
    followed_advice = serializers.BooleanField(required=False, allow_null=True, default=None)


# Публічний лічильник на лендингу — лише коли підсумків достатньо, щоб відсоток щось означав
PUBLIC_STATS_MIN = 20
PUBLIC_STATS_CACHE = 'journal:public-stats'


def outcome_stats(entries):
    """Як вийшли підсумовані рішення: усього й окремо ті, що за порадою Clarity.

    rate — частка «Добре» серед рішень за порадою (None, доки таких немає).
    «По-різному» не рахуємо ні успіхом, ні провалом, але показуємо."""
    reviewed = entries.filter(reviewed_at__isnull=False).exclude(outcome='')
    data = reviewed.aggregate(
        total=Count('pk'),
        good=Count('pk', filter=Q(outcome=Decision.Outcome.GOOD)),
        mixed=Count('pk', filter=Q(outcome=Decision.Outcome.MIXED)),
        bad=Count('pk', filter=Q(outcome=Decision.Outcome.BAD)),
        followed=Count('pk', filter=Q(followed_advice=True)),
        followed_good=Count('pk', filter=Q(followed_advice=True, outcome=Decision.Outcome.GOOD)),
    )
    data['rate'] = round(100 * data['followed_good'] / data['followed']) if data['followed'] else None
    return data


class UpdateDecisionSerializer(serializers.Serializer):
    decision = serializers.CharField(max_length=DECISION_MAX, required=False)
    done_steps = serializers.ListField(child=serializers.IntegerField(min_value=0), required=False)
    outcome = serializers.ChoiceField(choices=Decision.Outcome.choices, required=False)
    reflection = serializers.CharField(max_length=REFLECTION_MAX, required=False, allow_blank=True)
    # «Ще рано» — спитати пізніше; підсумок, якщо був, при цьому скидається
    remind_in_days = serializers.ChoiceField(choices=REMIND_CHOICES, required=False)


def _snapshot(discussion):
    summary = discussion.final_summary if isinstance(discussion.final_summary, dict) else {}
    steps = [str(item) for item in summary.get('next_steps') or [] if str(item).strip()]
    if not steps and summary.get('recommendation'):
        steps = [str(summary['recommendation'])]
    triggers = [str(item) for item in summary.get('change_triggers') or [] if str(item).strip()]
    return steps[:5], triggers[:4]


class JournalListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        entries = Decision.objects.filter(user=request.user).prefetch_related(
            'revisits__journal_entry'
        )
        now = timezone.now()
        return Response(
            {
                'results': DecisionSerializer(entries, many=True).data,
                'due_count': due_entries(request.user, now).count(),
                'stats': outcome_stats(Decision.objects.filter(user=request.user)),
            },
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        serializer = CreateDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        discussion = Discussion.objects.filter(user=request.user, pk=data['discussion']).first()
        if discussion is None:
            return Response(
                {'detail': L('Дискусію не знайдено', 'Discussion not found')},
                status=status.HTTP_404_NOT_FOUND,
            )
        if not discussion.is_finished:
            return Response({'detail': NOT_FINISHED}, status=status.HTTP_400_BAD_REQUEST)
        steps, triggers = _snapshot(discussion)
        check_at = timezone.now() + timedelta(days=data['remind_in_days'])
        # одна дискусія — один запис: повторне збереження оновлює рішення й дату
        entry, created = Decision.objects.update_or_create(
            discussion=discussion,
            defaults={
                'user': request.user,
                'question': discussion.question,
                'decision': data['decision'].strip(),
                'steps': steps,
                'triggers': triggers,
                'language': discussion.language,
                'check_at': check_at,
                'reminded_at': None,
                'followed_advice': data['followed_advice'],
            },
        )
        return Response(
            DecisionSerializer(entry).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class JournalDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_entry(self, request, pk):
        return Decision.objects.filter(user=request.user, pk=pk).first()

    def patch(self, request, pk):
        entry = self.get_entry(request, pk)
        if entry is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        serializer = UpdateDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if 'decision' in data and data['decision'].strip():
            entry.decision = data['decision'].strip()
        if 'done_steps' in data:
            entry.done_steps = sorted({i for i in data['done_steps'] if i < len(entry.steps)})
        if 'reflection' in data:
            entry.reflection = data['reflection'].strip()
        if 'outcome' in data:
            entry.outcome = data['outcome']
            entry.reviewed_at = timezone.now()
        if 'remind_in_days' in data:
            entry.check_at = timezone.now() + timedelta(days=data['remind_in_days'])
            entry.reminded_at = None
            entry.reviewed_at = None
            entry.outcome = ''
        entry.save()
        return Response(DecisionSerializer(entry).data, status=status.HTTP_200_OK)

    def delete(self, request, pk):
        entry = self.get_entry(request, pk)
        if entry is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class JournalStatsView(APIView):
    """Публічний лічильник: як часто спрацьовують рішення за порадою Clarity.

    Лише агреговані числа без жодних даних людей; поки підсумків менше за
    PUBLIC_STATS_MIN — {'ready': false}, і лендинг лічильника не показує."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        data = cache.get(PUBLIC_STATS_CACHE)
        if data is None:
            stats = outcome_stats(Decision.objects.filter(user__is_guest=False))
            ready = stats['followed'] >= PUBLIC_STATS_MIN
            data = {'ready': ready, **({'rate': stats['rate'], 'followed': stats['followed']} if ready else {})}
            cache.set(PUBLIC_STATS_CACHE, data, 600)
        return Response(data, status=status.HTTP_200_OK)


class JournalUnsubscribeView(APIView):
    """POST — відписка від листів журналу за посиланням із листа, без входу.

    Ту саму адресу поштові клієнти викликають за List-Unsubscribe-Post
    (RFC 8058). GET нічого не змінює: посилання в листах заздалегідь відкривають
    антивіруси й прев'ю, тож людина підтверджує відписку на сторінці."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token):
        user = reminders.user_from_unsubscribe(token)
        if user is None:
            return Response(
                {'detail': L('Посилання недійсне.', 'The link is invalid.'), 'code': 'invalid_link'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reminders.unsubscribe(user)
        return Response(
            {'detail': L('Листи журналу вимкнено.', 'Journal emails are turned off.')},
            status=status.HTTP_200_OK,
        )


class JournalDueView(APIView):
    """Скільки рішень чекають на «Як воно?» — для значка в меню й картки на головній."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        due = due_entries(request.user)
        first = due.first()
        return Response(
            {
                'count': due.count(),
                'next': DecisionSerializer(first).data if first else None,
            },
            status=status.HTTP_200_OK,
        )
