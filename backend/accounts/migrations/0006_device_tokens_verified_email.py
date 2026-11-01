import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def mark_google_accounts_verified(apps, schema_editor):
    # акаунт без пароля створено входом через Google — пошту там уже перевірено
    User = apps.get_model('accounts', 'User')
    User.objects.filter(password__startswith='!').update(email_verified=True)


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0005_user_about'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='email_verified',
            field=models.BooleanField(default=False, verbose_name='пошту підтверджено'),
        ),
        migrations.RunPython(mark_google_accounts_verified, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='loginattempt',
            name='email',
            field=models.EmailField(max_length=254, verbose_name='пошта'),
        ),
        migrations.AddField(
            model_name='loginattempt',
            name='ip',
            field=models.CharField(blank=True, default='', max_length=64, verbose_name='IP'),
        ),
        migrations.AddConstraint(
            model_name='loginattempt',
            constraint=models.UniqueConstraint(fields=('email', 'ip'), name='unique_login_attempt_per_ip'),
        ),
        migrations.CreateModel(
            name='AuthToken',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key_hash', models.CharField(max_length=64, unique=True, verbose_name='хеш ключа')),
                ('label', models.CharField(blank=True, default='', max_length=200, verbose_name='пристрій')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='створено')),
                ('last_used_at', models.DateTimeField(blank=True, null=True, verbose_name='востаннє')),
                ('expires_at', models.DateTimeField(verbose_name='діє до')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='auth_tokens', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'вхід',
                'verbose_name_plural': 'входи',
            },
        ),
    ]
