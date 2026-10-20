from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('discussions', '0002_discussion_mode_discussion_options'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='reply_to',
            field=models.CharField(
                blank=True,
                default='',
                max_length=64,
                verbose_name='відповідає учаснику',
            ),
            preserve_default=False,
        ),
    ]
