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
        # учасники оцінюють варіанти за критеріями людини
        SCORING = 'scoring', 'Оцінка за критеріями'
        SYNTHESIS = 'synthesis', 'Пропозиція рішення'
        DEVIL = 'devil', 'Перевірка AI Devil'
        REBUTTAL = 'rebuttal', 'Відповідь на AI Devil'
        FINAL = 'final', 'Фінальний підсумок'
        # швидкий режим: одна коротка відповідь без дебатів
        QUICK = 'quick', 'Швидка відповідь'
        # після фіналу людина звертається до одного учасника
        ANSWER = 'answer', 'Відповідь учасника'
        DONE = 'done', 'Готово'

    class Safety(models.TextChoices):
        CRISIS = 'crisis', 'Кризовий стан'
        MEDICAL = 'medical', 'Здоров’я'
        LEGAL = 'legal', 'Право'
        FINANCIAL = 'financial', 'Великі гроші'

    class Feedback(models.TextChoices):
        HELPED = 'helped', 'Допомогло'
        NOT_HELPED = 'not_helped', 'Не допомогло'

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
    # «Про мене» автора на момент створення: зміни профілю не переписують старих дискусій
    profile = models.JSONField('профіль автора', default=dict, blank=True)
    # швидкий режим: одна коротка відповідь замість дебатів
    quick = models.BooleanField('швидка відповідь', default=False)
    # чутлива тема: криза — без дебатів і з контактами допомоги; решта — застереження
    safety = models.CharField('чутлива тема', max_length=12, choices=Safety.choices, blank=True)
    # критерії для «Один із варіантів»: [{name, weight 1–5}] і оцінки учасників
    criteria = models.JSONField('критерії', default=list, blank=True)
    scores = models.JSONField('оцінки учасників', default=dict, blank=True)
    matrix = models.JSONField('матриця критеріїв', null=True, blank=True)
    # після фіналу: кому з учасників адресоване питання і скільки таких питань було
    ask_target = models.CharField('питання до учасника', max_length=32, blank=True, default='')
    direct_questions = models.PositiveSmallIntegerField('питань учасникам', default=0)
    # чи допоміг висновок — так ми знаємо, чи Clarity корисний насправді
    feedback = models.CharField('оцінка висновку', max_length=12, choices=Feedback.choices, blank=True)
    feedback_note = models.TextField('коментар до оцінки', max_length=500, blank=True)
    feedback_at = models.DateTimeField('оцінено', null=True, blank=True)
    personas = models.JSONField('персони', default=list)
    rounds = models.PositiveSmallIntegerField('раундів дискусії', default=2)
    web_search = models.BooleanField('пошук в інтернеті', default=False)
    sources = models.JSONField('знайдені джерела', default=list, blank=True)
    search_count = models.PositiveSmallIntegerField('пошукових запитів', default=0)
    moderator_model = models.CharField('модель модератора', max_length=120, blank=True, default='')
    devil_model = models.CharField('модель AI Devil', max_length=120, blank=True, default='')
    followups = models.PositiveSmallIntegerField('уточнень після фіналу', default=0)
    stop_requested = models.BooleanField('зупинку запитано', default=False)
    # Черга воркера (DISCUSSION_RUNNER=worker): коли попросили виконувати кроки.
    # Скидається, коли дискусія завершилась, зупинилась чи чекає на людину.
    run_requested_at = models.DateTimeField(
        'запуск запитано', null=True, blank=True, editable=False, db_index=True
    )
    pinned = models.BooleanField('закріплено', default=False)
    archived = models.BooleanField('в архіві', default=False)
    # мова, якою створено дискусію: нею пишуть AI і рушій (uk | en)
    language = models.CharField('мова', max_length=5, default='uk')
    # Публічне посилання лише для читання: None — доступу немає
    share_token = models.UUIDField(
        'токен публічного посилання', null=True, blank=True, unique=True, editable=False
    )
    # чи показувати за посиланням відповіді автора на уточнення й інші його
    # повідомлення: там буває особисте (гроші, сім'я, вік). Типово — ні
    share_personal = models.BooleanField('посилання показує особисте', default=False)

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
    until_consensus = models.BooleanField('до повної згоди', default=False)
    early_stop = models.BooleanField('завершено раніше через консенсус', default=False)
    finished_early = models.BooleanField('користувач завершив достроково', default=False)
    advance_count = models.PositiveIntegerField('кроків виконано', default=0)
    advance_token = models.UUIDField(null=True, blank=True, editable=False)
    advance_started_at = models.DateTimeField(null=True, blank=True, editable=False)
    # Живий статус кроку для інтерфейсу: рядок від AI і поточний пошуковий запит.
    # Дійсний, лише поки live_token збігається з advance_token, тож не «залипає».
    live_token = models.UUIDField(null=True, blank=True, editable=False)
    live_status = models.CharField(max_length=120, blank=True, default='', editable=False)
    live_search = models.CharField(max_length=300, blank=True, default='', editable=False)
    # Репліки, які моделі ще пишуть: [{slug, name, phase, round, reply_to, reply_to_slug, text}]
    live_drafts = models.JSONField(default=list, blank=True, editable=False)

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


class Decision(models.Model):
    """Запис журналу рішень: що людина вирішила й як воно вийшло.

    Через обраний час Clarity питає «Як воно?» — у застосунку й листом.
    Питання, рішення, кроки й тригери скопійовано з дискусії: запис лишається
    осмисленим, навіть якщо дискусію потім видалили.
    """

    class Outcome(models.TextChoices):
        GOOD = 'good', 'Добре'
        MIXED = 'mixed', 'По-різному'
        BAD = 'bad', 'Погано'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='decisions',
        verbose_name='користувач',
    )
    discussion = models.OneToOneField(
        Discussion,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='journal_entry',
        verbose_name='дискусія',
    )
    question = models.TextField('запитання', max_length=6000)
    decision = models.TextField('рішення', max_length=2000)
    # план на тиждень із висновку й номери вже зроблених кроків
    steps = models.JSONField('кроки', default=list, blank=True)
    done_steps = models.JSONField('зроблені кроки', default=list, blank=True)
    triggers = models.JSONField('коли передумати', default=list, blank=True)
    # мова листа-нагадування — та, якою йшла дискусія
    language = models.CharField('мова', max_length=5, default='uk')
    check_at = models.DateTimeField('коли спитати «Як воно?»')
    reminded_at = models.DateTimeField('лист надіслано', null=True, blank=True)
    outcome = models.CharField('як вийшло', max_length=8, choices=Outcome.choices, blank=True)
    reflection = models.TextField('що зрозумів', max_length=1000, blank=True)
    reviewed_at = models.DateTimeField('підсумовано', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'рішення'
        verbose_name_plural = 'журнал рішень'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'check_at']),
            models.Index(fields=['reviewed_at', 'reminded_at', 'check_at']),
        ]

    def __str__(self):
        return f'{self.decision[:50]} ({self.user})'


class Attachment(models.Model):
    """Документ, доданий до питання: оффер, договір, резюме, оголошення.

    Зберігається лише витягнутий текст — самого файлу сервер не тримає. До
    створення дискусії вкладення ні до чого не прив'язане; такі «сироти»
    прибираються через добу.
    """

    class Kind(models.TextChoices):
        PDF = 'pdf', 'PDF'
        DOCX = 'docx', 'Word'
        TEXT = 'text', 'Текст'
        IMAGE = 'image', 'Фото'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='attachments',
        verbose_name='користувач',
    )
    discussion = models.ForeignKey(
        Discussion,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='attachments',
        verbose_name='дискусія',
    )
    # файл, доданий до уточнення в чаті; у файлів самого питання — порожньо
    message = models.ForeignKey(
        Message,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attachments',
        verbose_name='повідомлення',
    )
    name = models.CharField('назва файлу', max_length=200)
    kind = models.CharField('тип', max_length=8, choices=Kind.choices)
    size = models.PositiveIntegerField('розмір, байт')
    text = models.TextField('текст документа')
    # текст обрізано до ліміту — моделі бачать не весь документ
    truncated = models.BooleanField('обрізано', default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'вкладення'
        verbose_name_plural = 'вкладення'
        ordering = ['created_at']

    def __str__(self):
        return self.name


class CustomPersona(models.Model):
    """Своя роль учасника: «юрист», «фінансовий консультант», «мій обережний тато».

    У дискусію потрапляє копія ролі, тож зміна чи видалення ролі не переписує
    старих дискусій.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='custom_personas',
        verbose_name='користувач',
    )
    name = models.CharField('назва ролі', max_length=40)
    # хто це й як міркує — з цього модель розуміє, як говорити
    description = models.TextField('хто це й як міркує', max_length=400)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'своя роль'
        verbose_name_plural = 'свої ролі'
        ordering = ['created_at']

    def __str__(self):
        return self.name

    @property
    def slug(self):
        # коротко, бо slug учасника живе в повідомленнях (max_length=32)
        return f'c-{self.id.hex[:12]}'
