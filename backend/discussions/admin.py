from django.contrib import admin

from .models import Discussion, Message


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
