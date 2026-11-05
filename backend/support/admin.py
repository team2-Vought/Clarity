import json

from django.contrib import admin
from django.utils import timezone
from django.utils.html import format_html

from .models import BugReport

CLOSED = {BugReport.Status.FIXED, BugReport.Status.WONT_FIX, BugReport.Status.DUPLICATE}


@admin.register(BugReport)
class BugReportAdmin(admin.ModelAdmin):
    list_display = ('reference', 'kind', 'status', 'short_description', 'who', 'page', 'created_at')
    list_display_links = ('reference', 'short_description')
    list_filter = ('status', 'kind', 'language', 'created_at')
    search_fields = ('description', 'contact_email', 'user__email', 'page')
    list_editable = ('status',)
    readonly_fields = (
        'reference', 'user', 'kind', 'description', 'contact_email', 'page', 'discussion',
        'message', 'language', 'pretty_context', 'created_at', 'resolved_at',
    )
    fields = (
        'reference', 'kind', 'status', 'staff_note', 'description', 'contact_email', 'user',
        'page', 'discussion', 'message', 'language', 'pretty_context', 'created_at',
        'resolved_at',
    )
    actions = ['mark_confirmed', 'mark_fixed']

    @admin.display(description='Номер')
    def reference(self, obj):
        return obj.reference

    @admin.display(description='Опис')
    def short_description(self, obj):
        return obj.description[:80]

    @admin.display(description='Від кого')
    def who(self, obj):
        return obj.contact_email or (obj.user.email if obj.user else 'гість')

    @admin.display(description='Технічні дані')
    def pretty_context(self, obj):
        text = json.dumps(obj.context or {}, ensure_ascii=False, indent=2)
        return format_html('<pre style="white-space: pre-wrap; margin: 0">{}</pre>', text)

    def save_model(self, request, obj, form, change):
        # дата закриття ставиться сама, щойно звернення отримало кінцевий стан
        if obj.status in CLOSED and obj.resolved_at is None:
            obj.resolved_at = timezone.now()
        elif obj.status not in CLOSED:
            obj.resolved_at = None
        super().save_model(request, obj, form, change)

    @admin.action(description='Позначити підтвердженими')
    def mark_confirmed(self, request, queryset):
        queryset.update(status=BugReport.Status.CONFIRMED, resolved_at=None)

    @admin.action(description='Позначити виправленими')
    def mark_fixed(self, request, queryset):
        queryset.update(status=BugReport.Status.FIXED, resolved_at=timezone.now())
