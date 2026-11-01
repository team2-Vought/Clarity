from django.contrib import admin
from django.contrib.admin.forms import AdminAuthenticationForm
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.core.exceptions import ValidationError
from rest_framework.exceptions import Throttled

from .login_limit import check_login_allowed, register_failed_login, reset_login_attempts
from .models import AuthToken, LoginAttempt, User
from .tokens import client_ip


class LimitedAdminAuthenticationForm(AdminAuthenticationForm):
    """Вхід в адмінку з тим самим лімітом спроб, що й в API: «IP + пошта»."""

    def clean(self):
        email = (self.cleaned_data.get('username') or '').strip().lower()
        ip = client_ip(self.request) if self.request is not None else ''
        try:
            check_login_allowed(ip, email)
        except Throttled as exc:
            raise ValidationError(str(exc.detail), code='throttled')
        try:
            cleaned = super().clean()
        except ValidationError:
            register_failed_login(ip, email)
            raise
        reset_login_attempts(email, ip=ip)
        return cleaned


admin.site.login_form = LimitedAdminAuthenticationForm


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ('email', 'name', 'is_staff', 'date_joined')
    search_fields = ('email', 'name')
    ordering = ('email',)
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Персональні дані', {'fields': ('name',)}),
        ('Права', {'fields': ('is_active', 'email_verified', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        ('Важливі дати', {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {'fields': ('email', 'name', 'password1', 'password2')}),
    )
    filter_horizontal = ('groups', 'user_permissions')


@admin.register(LoginAttempt)
class LoginAttemptAdmin(admin.ModelAdmin):
    list_display = ('email', 'ip', 'failed_count', 'locked_until', 'updated_at')
    search_fields = ('email', 'ip')


@admin.register(AuthToken)
class AuthTokenAdmin(admin.ModelAdmin):
    """Входи на пристроях: видалити запис — вийти на тому пристрої."""

    list_display = ('user', 'label', 'created_at', 'last_used_at', 'expires_at')
    search_fields = ('user__email', 'label')
    readonly_fields = ('user', 'key_hash', 'label', 'created_at', 'last_used_at', 'expires_at')
