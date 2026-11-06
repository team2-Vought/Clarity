from datetime import timedelta

from django.utils import timezone

from discussions.models import Discussion
from discussions.services.engine.tree import normalize_tree, tree_problems

from .test_decision_tools import ToolsTestCase


class DecisionTreeApiTests(ToolsTestCase):
    def finished(self, **extra):
        created = self.create(**extra)
        discussion = self.run_discussion(created['id'])
        self.assertEqual(discussion.phase, Discussion.Phase.DONE)
        return discussion

    def url(self, discussion):
        return f'/api/discussions/{discussion.pk}/tree/'

    def test_builds_saves_and_reuses_the_tree(self):
        discussion = self.finished()
        empty = self.client.get(self.url(discussion)).data
        self.assertEqual((empty['tree'], empty['state']), (None, 'none'))

        response = self.client.post(self.url(discussion), {}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['state'], 'ready')
        tree = response.data['tree']
        self.assertEqual([b['status'] for b in tree['branches']], ['chosen', 'alternative'])
        self.assertEqual(tree['branches'][0]['id'], 'b1')
        self.assertEqual(tree['branches'][0]['outcomes'][0]['id'], 'b1o1')
        # прихильники — з кольором і slug учасника, щоб схема показала, хто за чим стояв
        self.assertEqual(tree['branches'][0]['supporters'][0]['slug'], 'logician')
        self.assertEqual(tree['path'][-1]['who']['slug'], 'moderator')
        self.assertEqual(Discussion.objects.get(pk=discussion.pk).decision_tree['root'], tree['root'])

        # повторний запит без rebuild моделі не кличе
        calls = len(self.provider.calls)
        again = self.client.post(self.url(discussion), {}, format='json')
        self.assertEqual(again.data['tree'], tree)
        self.assertEqual(len(self.provider.calls), calls)

        # скласти вдруге не можна: навіть з rebuild повертається те саме дерево
        again = self.client.post(self.url(discussion), {'rebuild': True}, format='json')
        self.assertEqual(again.data['tree'], tree)
        self.assertEqual(len(self.provider.calls), calls)

    def test_tree_is_in_the_discussion_payload(self):
        discussion = self.finished()
        self.client.post(self.url(discussion), {}, format='json')
        detail = self.client.get(f'/api/discussions/{discussion.pk}/')
        self.assertEqual(len(detail.data['decision_tree']['branches']), 2)

    def test_not_ready_until_the_conclusion(self):
        created = self.create()
        response = self.client.post(f'/api/discussions/{created["id"]}/tree/', {}, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'not_ready')

    def test_someone_elses_discussion_is_not_found(self):
        discussion = self.finished()
        other = type(self.user).objects.create_user(email='other@test.com', name='Інший', password='pass123!A')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.post(self.url(discussion), {}, format='json').status_code, 404)
        self.assertEqual(self.client.get(self.url(discussion)).status_code, 404)

    def test_a_broken_reply_is_an_error_not_an_empty_tree(self):
        discussion = self.finished()
        self.provider.tree_reply = {'branches': [{'title': 'Одна гілка', 'status': 'chosen'}]}
        response = self.client.post(self.url(discussion), {}, format='json')
        self.assertEqual(response.data['state'], 'error')
        self.assertIn('дерево рішень', response.data['error'])
        saved = Discussion.objects.get(pk=discussion.pk)
        self.assertIsNone(saved.decision_tree)
        self.assertEqual(saved.tree_state, 'error')
        # з помилки можна почати знову
        self.provider.tree_reply = None
        again = self.client.post(self.url(discussion), {}, format='json')
        self.assertEqual(again.data['state'], 'ready')

    def test_while_building_another_click_does_not_call_the_model(self):
        discussion = self.finished()
        now = timezone.now()
        Discussion.objects.filter(pk=discussion.pk).update(
            tree_state='building', tree_started_at=now, tree_heartbeat_at=now
        )
        calls = len(self.provider.calls)
        response = self.client.post(self.url(discussion), {}, format='json')
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data['state'], 'building')
        self.assertEqual(len(self.provider.calls), calls)

    def test_a_build_cut_off_by_a_restart_can_be_started_again(self):
        discussion = self.finished()
        # пульс затих: потік загинув разом із процесом
        long_ago = timezone.now() - timedelta(minutes=3)
        Discussion.objects.filter(pk=discussion.pk).update(
            tree_state='building', tree_started_at=long_ago, tree_heartbeat_at=long_ago
        )
        self.assertEqual(self.client.get(self.url(discussion)).data['state'], 'error')
        response = self.client.post(self.url(discussion), {}, format='json')
        self.assertEqual(response.data['state'], 'ready')

    def test_choose_one_branches_are_the_users_options(self):
        discussion = self.finished(mode='choose_one', options=['Київ', 'Львів', 'Одеса'])
        self.provider.tree_reply = {
            'branches': [
                {'title': 'львів', 'status': 'alternative', 'fit': 60},
                {'title': 'Київ', 'status': 'chosen', 'fit': 80},
            ],
        }
        tree = self.client.post(self.url(discussion), {}, format='json').data['tree']
        self.assertEqual([b['title'] for b in tree['branches']], ['Київ', 'Львів', 'Одеса'])
        # обрана — та, що у висновку (фейковий модератор обирає перший варіант)
        self.assertEqual([b['status'] for b in tree['branches']], ['chosen', 'alternative', 'alternative'])

    def test_a_new_conclusion_drops_the_old_tree(self):
        discussion = self.finished()
        self.client.post(self.url(discussion), {}, format='json')
        self.client.post(
            f'/api/discussions/{discussion.pk}/messages/',
            {'content': 'А якщо зарплата буде меншою?'},
            format='json',
        )
        discussion = self.run_discussion(discussion.pk)
        self.assertIsNone(discussion.decision_tree)
        self.assertEqual(self.client.get(self.url(discussion)).data['state'], 'none')


    def test_a_too_short_train_of_thought_is_completed_from_the_discussion(self):
        discussion = self.finished()
        self.provider.tree_reply = {
            **self.provider._tree(),
            'path': [{'stage': 'turn', 'title': 'Подушка', 'text': 'Грошей вистачить.', 'who': 'Логік'}],
        }
        tree = self.client.post(self.url(discussion), {}, format='json').data['tree']
        stages = [step['stage'] for step in tree['path']]
        # своє модель зберігає, бракуючі етапи — з дискусії, у природному порядку
        self.assertEqual(stages[0], 'question')
        self.assertIn('turn', stages)
        self.assertEqual(stages[-1], 'conclusion')
        self.assertGreaterEqual(len(stages), 3)
        self.assertEqual(tree['path'][-1]['who']['slug'], 'moderator')


class DecisionTreeNormalizeTests(ToolsTestCase):
    def test_exactly_one_branch_is_chosen(self):
        discussion = Discussion(question='Питання?', mode='open', final_summary={'decision': 'X'})
        data = {
            'branches': [
                {'title': 'А', 'status': 'chosen', 'fit': 40},
                {'title': 'Б', 'status': 'chosen', 'fit': 90},
                {'title': 'В', 'status': 'щось', 'fit': 300},
            ],
            'path': [{'stage': 'вигадане', 'title': 'Крок'}],
        }
        tree = normalize_tree(data, discussion, [])
        self.assertEqual([b['status'] for b in tree['branches']], ['alternative', 'chosen', 'alternative'])
        self.assertEqual(tree['branches'][2]['fit'], 100)
        step = next(step for step in tree['path'] if step['title'] == 'Крок')
        self.assertEqual(step['stage'], 'debate')
        self.assertEqual(tree['root'], 'Питання?')

    def test_yes_no_chosen_follows_the_answer(self):
        discussion = Discussion(question='Чи?', mode='yes_no', final_summary={'answer': 'ні'})
        data = {'branches': [{'title': 'Так, переїхати', 'status': 'chosen'}, {'title': 'Ні', 'status': 'rejected'}]}
        tree = normalize_tree(data, discussion, [])
        self.assertEqual([b['status'] for b in tree['branches']], ['alternative', 'chosen'])

    def test_tidies_up_what_the_model_wrote(self):
        discussion = Discussion(question='Чи?', mode='open', final_summary={'decision': 'X'})
        personas = [{'slug': 'logician', 'name': 'Учасник 1', 'color': '#2563eb'}]
        data = {
            'branches': [
                {
                    'title': 'переїхати',
                    'status': 'chosen',
                    'pros': ['вища зарплата'],
                    'outcomes': [{'condition': 'якщо пройти випробувальний', 'result': 'то підписати оренду'}],
                },
                {'title': 'Лишитися', 'status': 'alternative'},
            ],
            'path': [
                {'stage': 'debate', 'title': 'Обговорення', 'text': 'Логік за, Скептик проти.', 'who': 'Учасники'},
                {'stage': 'turn', 'title': 'Віддалений місяць', 'text': 'Спершу з дому.', 'who': 'Логік'},
            ],
        }
        tree = normalize_tree(data, discussion, personas)
        chosen = tree['branches'][0]
        self.assertEqual(chosen['title'], 'Переїхати')
        self.assertEqual(chosen['pros'], ['Вища зарплата'])
        self.assertEqual(chosen['outcomes'][0]['condition'], 'Якщо пройти випробувальний')
        # «то» прибрано: стрілку перед наслідком малює інтерфейс
        self.assertEqual(chosen['outcomes'][0]['result'], 'Підписати оренду')
        first = next(step for step in tree['path'] if step['stage'] == 'debate')
        second = next(step for step in tree['path'] if step['stage'] == 'turn')
        # заголовок-назва етапу поступається суті, а «Учасники» — не автор
        self.assertEqual((first['title'], first['text']), ('Логік за, Скептик проти.', ''))
        self.assertIsNone(first['who'])
        # роль «Логік» веде до учасника з ім'ям, яке дала людина
        self.assertEqual((second['who']['slug'], second['who']['name']), ('logician', 'Учасник 1'))

    def test_a_long_step_title_is_cut_at_a_word_and_kept_in_full_below(self):
        discussion = Discussion(question='Чи?', mode='open', final_summary={'decision': 'X'})
        long = 'Переїхати, спочатку місяць віддалено, потім оренда з фінансовою подушкою на чотири місяці'
        data = {
            'branches': [{'title': 'А', 'status': 'chosen'}, {'title': 'Б'}],
            'path': [{'stage': 'conclusion', 'title': long, 'text': long}],
        }
        step = next(step for step in normalize_tree(data, discussion, [])['path'] if step['text'] == long)
        self.assertTrue(step['title'].endswith('…'))
        self.assertLessEqual(len(step['title']), 80)
        self.assertFalse(step['title'][:-1].endswith(' '))
        self.assertEqual(step['text'], long)

    def test_problems_ask_for_branches_and_a_chosen_one(self):
        path = [{'title': 'Питання'}, {'title': 'Суперечка'}, {'title': 'Висновок'}]
        self.assertTrue(tree_problems({'branches': [], 'path': path}, 'open', []))
        self.assertTrue(tree_problems({'branches': [{'title': 'А'}, {'title': 'Б'}], 'path': path}, 'open', []))
        good = {'branches': [{'title': 'А', 'status': 'chosen'}, {'title': 'Б'}], 'path': path}
        self.assertEqual(tree_problems(good, 'open', []), [])
        # хід думок з одного кроку — це переказ, а не шлях до висновку
        self.assertTrue(tree_problems({**good, 'path': path[:1]}, 'open', []))
