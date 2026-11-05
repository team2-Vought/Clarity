import uuid

from django.conf import settings
from django.db import models


class BugReport(models.Model):
    """Звернення «Знайшли баги?»: що зламалося, дивна відповідь AI чи ідея.

    Технічні дані (браузер, екран, останні помилки) людина бачить перед
    надсиланням і може їх не додавати. Дискусію додаємо лише з її згоди.
    """

    class Kind(models.TextChoices):
        BUG = 'bug', 'Щось не працює'
        AI_ANSWER = 'ai_answer', 'Дивна відповідь AI'
        IDEA = 'idea', 'Ідея'
        OTHER = 'other', 'Інше'

    class Status(models.TextChoices):
        NEW = 'new', 'Нове'
        CONFIRMED = 'confirmed', 'Підтверджено'
        FIXED = 'fixed', 'Виправлено'
        WONT_FIX = 'wont_fix', 'Не виправлятимемо'
        DUPLICATE = 'duplicate', 'Дублікат'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # звернення — дані людини: з видаленням акаунта зникають і вони
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='bug_reports',
        verbose_name='користувач',
    )
    kind = models.CharField('тип', max_length=12, choices=Kind.choices, default=Kind.BUG)
    description = models.TextField('опис', max_length=4000)
    # куди відповісти: пошта акаунта, якщо людина дозволила, або вказана гостем
    contact_email = models.EmailField('пошта для відповіді', blank=True, default='')
    # лише шлях сторінки — без query й #, де бувають токени
    page = models.CharField('сторінка', max_length=300, blank=True, default='')
    # дискусія й репліка — лише з явної згоди людини показати їх команді
    discussion = models.ForeignKey(
        'discussions.Discussion',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='bug_reports',
        verbose_name='дискусія',
    )
    message = models.ForeignKey(
        'discussions.Message',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='bug_reports',
        verbose_name='репліка',
    )
    context = models.JSONField('технічні дані', default=dict, blank=True)
    language = models.CharField('мова', max_length=5, default='uk')
    status = models.CharField('стан', max_length=12, choices=Status.choices, default=Status.NEW)
    staff_note = models.TextField('нотатка команди', blank=True, default='')
    created_at = models.DateTimeField('надіслано', auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField('закрито', null=True, blank=True)

    class Meta:
        verbose_name = 'звернення'
        verbose_name_plural = 'звернення «Знайшли баги?»'
        ordering = ['-created_at']
        indexes = [models.Index(fields=['status', '-created_at'])]

    def __str__(self):
        return f'#{self.reference} {self.get_kind_display()}: {self.description[:50]}'

    @property
    def reference(self):
        """Короткий номер, який людина бачить і може назвати в листі."""
        return self.id.hex[:8].upper()
