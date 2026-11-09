from django.db import migrations


def mark_existing_verified(apps, schema_editor):
    # Підтвердження пошти після реєстрації з'явилось пізніше за акаунти, що вже є:
    # їх не блокуємо — вимога стосується нових реєстрацій
    User = apps.get_model('accounts', 'User')
    User.objects.filter(email_verified=False).update(email_verified=True)


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0006_device_tokens_verified_email'),
    ]

    operations = [
        migrations.RunPython(mark_existing_verified, migrations.RunPython.noop),
    ]
