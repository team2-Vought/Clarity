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
        CLARIFY = 'clarify', 'Уточнення контексту'
        RESEARCH = 'research', 'Пошук джерел'
        OPENING = 'opening', 'Вступні слова'
        DEBATE = 'debate', 'Дискусія'
        SYNTHESIS = 'synthesis', 'Пропозиція рішення'
        DEVIL = 'devil', 'Перевірка AI Devil'
        REBUTTAL = 'rebuttal', 'Відповідь на AI Devil'
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
    question = models.TextField('запитання', max_length=6000)
    mode = models.CharField(
        max_length=16,
        choices=Mode.choices,
        default=Mode.OPEN,
        verbose_name='режим відповіді',
    )
    options = models.JSONField('варіанти відповіді', default=list, blank=True)
    # Відповіді на уточнювальні питання модератора перед стартом: [{question, answer}]
    clarifications = models.JSONField('уточнення перед стартом', default=list, blank=True)
    # Питання модератора, на які ще чекаємо відповіді: [{id, question, options}]
    clarify_questions = models.JSONField('питання модератора', default=list, blank=True)
    personas = models.JSONField('персони', default=list)
    rounds = models.PositiveSmallIntegerField('раундів дискусії', default=2)
    web_search = models.BooleanField('пошук в інтернеті', default=False)
    sources = models.JSONField('знайдені джерела', default=list, blank=True)
    search_count = models.PositiveSmallIntegerField('пошукових запитів', default=0)
    moderator_model = models.CharField('модель модератора', max_length=120, blank=True, default='')
    devil_model = models.CharField('модель AI Devil', max_length=120, blank=True, default='')
    followups = models.PositiveSmallIntegerField('уточнень після фіналу', default=0)
    stop_requested = models.BooleanField('зупинку запитано', default=False)
    pinned = models.BooleanField('закріплено', default=False)
    archived = models.BooleanField('в архіві', default=False)
    # Публічне посилання лише для читання: None — доступу немає
    share_token = models.UUIDField(
        'токен публічного посилання', null=True, blank=True, unique=True, editable=False
    )

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
    early_stop = models.BooleanField('завершено раніше через консенсус', default=False)
    advance_count = models.PositiveIntegerField('кроків виконано', default=0)
    advance_token = models.UUIDField(null=True, blank=True, editable=False)
    advance_started_at = models.DateTimeField(null=True, blank=True, editable=False)
    # Живий статус кроку для інтерфейсу: рядок від AI і поточний пошуковий запит.
    # Дійсний, лише поки live_token збігається з advance_token, тож не «залипає».
    live_token = models.UUIDField(null=True, blank=True, editable=False)
    live_status = models.CharField(max_length=120, blank=True, default='', editable=False)
    live_search = models.CharField(max_length=300, blank=True, default='', editable=False)

    best_solution = models.JSONField(null=True, blank=True)
    devil_review = models.JSONField(null=True, blank=True)
    final_summary = models.JSONField(null=True, blank=True)
    error = models.TextField(blank=True)
    error_code = models.CharField(max_length=32, blank=True, default='')
    # Безпечний для показу користувачу текст помилки (без сирих відповідей провайдера).
    error_public = models.CharField(max_length=300, blank=True, default='')

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

    @property
    def awaiting_clarification(self):
        """Модератор поставив питання й чекає відповідей — раннер стоїть."""
        return self.phase == self.Phase.CLARIFY and bool(self.clarify_questions)


class Message(models.Model):
    class Role(models.TextChoices):
        USER = 'user', 'Користувач'
        AI = 'ai', 'AI-учасник'
        MODERATOR = 'moderator', 'Модератор'
        DEVIL = 'devil', 'AI Devil'
        RESEARCH = 'research', 'Пошук'

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
    reply_to = models.CharField('відповідає учаснику', max_length=64, blank=True)
    reply_to_slug = models.CharField(
        'slug учасника, якому відповідає',
        max_length=32,
        blank=True,
        default='',
    )
    content = models.TextField('текст')
    thesis = models.CharField('головна теза', max_length=300, blank=True, default='')
    stance = models.CharField('позиція', max_length=100, blank=True, default='')
    search_query = models.CharField('пошуковий запит', max_length=300, blank=True, default='')
    source_ids = models.JSONField('додані джерела', default=list, blank=True)
    model_id = models.CharField('модель', max_length=120, blank=True, default='')
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


class DailyUsage(models.Model):
    """Денне використання AI для лімітів.

    Живе окремо від дискусій: видалення дискусії не повертає витрачений ліміт.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='daily_usage',
        verbose_name='користувач',
    )
    date = models.DateField('дата')
    discussions = models.PositiveIntegerField('створено дискусій', default=0)
    replies = models.PositiveIntegerField('AI-відповідей', default=0)

    class Meta:
        verbose_name = 'денне використання'
        verbose_name_plural = 'денне використання'
        ordering = ['-date']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'date'],
                name='unique_daily_usage_per_user',
            ),
        ]

    def __str__(self):
        return f'{self.user} {self.date}: {self.discussions} / {self.replies}'


class Team(models.Model):
    """Збережений склад учасників і суддів для повторного використання."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='teams',
        verbose_name='користувач',
    )
    name = models.CharField('назва', max_length=64)
    personas = models.JSONField('учасники', default=list)
    moderator_model = models.CharField('модель модератора', max_length=120, blank=True, default='')
    devil_model = models.CharField('модель AI Devil', max_length=120, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'команда'
        verbose_name_plural = 'команди'
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(fields=['user', 'name'], name='unique_team_name_per_user'),
        ]

    def __str__(self):
        return self.name
