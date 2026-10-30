from django.contrib import admin

from .models import DailyUsage, Decision, Discussion, Message, Team


class MessageInline(admin.StackedInline):
    model = Message
    extra = 0
    readonly_fields = ('seq', 'persona_name', 'content', 'created_at')


@admin.register(Discussion)
class DiscussionAdmin(admin.ModelAdmin):
    list_display = ('question_short', 'user', 'status', 'phase', 'created_at')
    list_filter = ('status', 'phase')
    search_fields = ('question', 'user__email')
    inlines = [MessageInline]

    @admin.display(description='Запитання')
    def question_short(self, obj):
        return obj.question[:60]


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('discussion_id', 'persona_name', 'role', 'seq', 'created_at')
    list_filter = ('role', 'phase')
    search_fields = ('content', 'persona_name')


@admin.register(DailyUsage)
class DailyUsageAdmin(admin.ModelAdmin):
    list_display = ('user', 'date', 'discussions', 'replies')
    list_filter = ('date',)
    search_fields = ('user__email',)


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ('name', 'user', 'updated_at')
    search_fields = ('name', 'user__email')


@admin.register(Decision)
class DecisionAdmin(admin.ModelAdmin):
    list_display = ('decision_short', 'user', 'check_at', 'outcome', 'reviewed_at')
    list_filter = ('outcome',)
    search_fields = ('decision', 'question', 'user__email')

    @admin.display(description='Рішення')
    def decision_short(self, obj):
        return obj.decision[:60]
