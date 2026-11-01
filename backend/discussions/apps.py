from django.apps import AppConfig


class DiscussionsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'discussions'
    verbose_name = 'дискусії'

    def ready(self):
        from . import checks  # noqa: F401 — реєструє перевірки налаштувань
