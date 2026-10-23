from django.db import migrations


def skip_research(apps, schema_editor):
    # Обов'язкового кроку пошуку більше немає: дискусії, що на ньому стоять,
    # одразу переходять до вступу, а учасники шукають самі за потреби
    Discussion = apps.get_model('discussions', 'Discussion')
    Discussion.objects.filter(phase='research').update(phase='opening')


class Migration(migrations.Migration):

    dependencies = [
        ('discussions', '0010_teams_sharing_pins'),
    ]

    operations = [
        migrations.RunPython(skip_research, migrations.RunPython.noop),
    ]
