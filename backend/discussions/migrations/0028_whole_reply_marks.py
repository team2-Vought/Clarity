from django.db import migrations, models

# реакції стали позначками на всю репліку з тими самими значеннями, що й у виділень
OLD_TO_NEW = {
    'convincing': 'agree',
    'insight': 'important',
    'unconvincing': 'doubt',
    'unclear': 'doubt',
    'wrong': 'doubt',
}


def forwards(apps, schema_editor):
    Message = apps.get_model('discussions', 'Message')
    for old, new in OLD_TO_NEW.items():
        Message.objects.filter(reaction=old).update(reaction=new)


class Migration(migrations.Migration):
    dependencies = [
        ('discussions', '0027_decision_tree'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='message',
            name='reaction',
            field=models.CharField(
                blank=True,
                choices=[('important', 'Важливо'), ('agree', 'Згоден'), ('doubt', 'Сумнів')],
                default='',
                max_length=16,
                verbose_name='позначка людини на всю репліку',
            ),
        ),
        migrations.AlterField(
            model_name='message',
            name='reaction_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='позначку поставлено'),
        ),
    ]
