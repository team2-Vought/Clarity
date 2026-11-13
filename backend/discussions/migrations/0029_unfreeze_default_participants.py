"""Збереження налаштувань раніше записувало й значення за замовчуванням, тож
«2 учасники» застигло в акаунтах, які його ніколи не обирали. Тепер за
замовчуванням — збалансований склад із трьох; старе «2» прибираємо, щоб
такі акаунти отримали нове значення.
"""

from django.conf import settings
from django.db import migrations


def unfreeze(apps, schema_editor):
    User = apps.get_model(*settings.AUTH_USER_MODEL.split('.'))
    for user in User.objects.exclude(preferences={}).only('pk', 'preferences').iterator():
        prefs = user.preferences
        if isinstance(prefs, dict) and prefs.get('default_participants') == 2:
            prefs.pop('default_participants')
            User.objects.filter(pk=user.pk).update(preferences=prefs)


class Migration(migrations.Migration):
    dependencies = [
        ('discussions', '0028_whole_reply_marks'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [migrations.RunPython(unfreeze, migrations.RunPython.noop)]
