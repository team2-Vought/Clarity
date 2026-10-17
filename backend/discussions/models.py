import uuid

from django.conf import settings
from django.db import models


class Discussion(models.Model):
    class Status(models.TextChoices):
        NEW = 'new', 'Нова'
        IN_PROGRESS = 'in_progress', 'Триває'
        DONE = 'done', 'Завершена'
        FAILED = 'failed', 'Помилка'

    class Phase(models.TextChoices):
        OPENING = 'opening', 'Вступні слова'
        DEBATE = 'debate', 'Дискусія'
        SYNTHESIS = 'synthesis', 'Пропозиція рішення'
        DEVIL = 'devil', 'Перевірка AI Devil'
        FINAL = 'final', 'Фінальний підсумок'
        DONE = 'done', 'Готово'

    class Mode(models.TextChoices):
        YES_NO = 'yes_no', 'Так або ні'
        CHOOSE_ONE = 'choose_one', 'Один із варіантів'
        OPEN = 'open', 'Вільна відповідь'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='discussions',
        verbose_name='користувач',
    )
    question = models.TextField('запитання', max_length=2000)
    mode = models.CharField(
        max_length=16,
        choices=Mode.choices,
        default=Mode.OPEN,
        verbose_name='режим відповіді',
    )
    options = models.JSONField('варіанти відповіді', default=list, blank=True)
    personas = models.JSONField('персони', default=list)
    rounds = models.PositiveSmallIntegerField('раундів дискусії', default=2)

    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.NEW,
    )
    phase = models.CharField(
        max_length=16,
        choices=Phase.choices,
        default=Phase.OPENING,
    )
    current_round = models.PositiveSmallIntegerField(default=1)
    speaker_index = models.PositiveSmallIntegerField(default=0)

    best_solution = models.JSONField(null=True, blank=True)
    devil_review = models.JSONField(null=True, blank=True)
    final_summary = models.JSONField(null=True, blank=True)
    error = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'дискусія'
        verbose_name_plural = 'дискусії'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at']),
        ]

    def __str__(self):
        return f'{self.question[:50]} ({self.get_status_display()})'

    @property
    def is_finished(self):
        return self.phase == self.Phase.DONE


class Message(models.Model):
    class Role(models.TextChoices):
        USER = 'user', 'Користувач'
        AI = 'ai', 'AI-учасник'
        MODERATOR = 'moderator', 'Модератор'
        DEVIL = 'devil', 'AI Devil'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    discussion = models.ForeignKey(
        Discussion,
        on_delete=models.CASCADE,
        related_name='messages',
        verbose_name='дискусія',
    )
    seq = models.PositiveIntegerField('порядок')
    phase = models.CharField(max_length=16, choices=Discussion.Phase.choices)
    round = models.PositiveSmallIntegerField('раунд', null=True, blank=True)
    role = models.CharField(max_length=16, choices=Role.choices)
    persona_slug = models.CharField(max_length=32)
    persona_name = models.CharField(max_length=64)
    avatar = models.CharField(max_length=16)
    color = models.CharField(max_length=16, blank=True)
    content = models.TextField('текст')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'повідомлення'
        verbose_name_plural = 'повідомлення'
        ordering = ['seq']
        constraints = [
            models.UniqueConstraint(
                fields=['discussion', 'seq'],
                name='unique_message_seq_per_discussion',
            ),
        ]

    def __str__(self):
        return f'#{self.seq} {self.persona_name}: {self.content[:40]}'
