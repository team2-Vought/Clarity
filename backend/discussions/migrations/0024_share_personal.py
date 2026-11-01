from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('discussions', '0023_attachment_message'),
    ]

    operations = [
        migrations.AddField(
            model_name='discussion',
            name='share_personal',
            field=models.BooleanField(default=False, verbose_name='посилання показує особисте'),
        ),
    ]
