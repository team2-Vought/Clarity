"""Журнал рішень: людина фіксує, що вирішила після дискусії, а через тиждень,
місяць чи три Clarity питає «Як воно?». Так складається історія власних
рішень і того, як вони спрацювали.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from backend.i18n import L, lazy_L

from .models import Decision, Discussion

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


def journal_state(discussion):
    """Що бачить чат під підсумком: чи рішення вже в журналі й коли спитаємо."""
    entry = getattr(discussion, 'journal_entry', None)
    if entry is None:
        return None
    return {'id': entry.id, 'check_at': entry.check_at, 'status': status_of(entry)}


class DecisionSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    discussion_id = serializers.UUIDField(read_only=True)

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
        ]

    def get_status(self, obj):
        return status_of(obj)


class CreateDecisionSerializer(serializers.Serializer):
    discussion = serializers.UUIDField()
    decision = serializers.CharField(
        max_length=DECISION_MAX,
        error_messages={'blank': REQUIRED, 'required': REQUIRED},
    )
    remind_in_days = serializers.ChoiceField(choices=REMIND_CHOICES, default=30)


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
        entries = Decision.objects.filter(user=request.user)
        now = timezone.now()
        return Response(
            {
                'results': DecisionSerializer(entries, many=True).data,
                'due_count': due_entries(request.user, now).count(),
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
