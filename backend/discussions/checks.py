"""Перевірки налаштувань для продакшну (`manage.py check --deploy`)."""

from django.conf import settings
from django.core.checks import Tags, Warning, register


@register(Tags.security, deploy=True)
def runner_check(app_configs, **kwargs):
    if settings.DISCUSSION_RUNNER == 'worker':
        return []
    return [
        Warning(
            'DISCUSSION_RUNNER=thread: дискусії виконуються потоками вебсервера.',
            hint=(
                'У продакшні задайте DISCUSSION_RUNNER=worker і запустіть '
                '`manage.py discussion_worker`: потоки переривають перезапуски, '
                'а їхню кількість обмежує лише DISCUSSION_THREAD_MAX.'
            ),
            id='discussions.W001',
        )
    ]
