"""Реакції й виділення в репліках AI: API, приватність і промпти учасників."""

from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.export import export_user
from discussions.models import Discussion, Highlight, Message
from discussions.serializers import DiscussionSerializer, SharedDiscussionSerializer
from discussions.services.engine.context import _list_messages
from discussions.services.prompts.context import _context_block, reader_marks
from discussions.views import HIGHLIGHTS_PER_MESSAGE

User = get_user_model()


class MarksTestCase(TestCase):
    def setUp(self):
        patcher = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request', return_value=True
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = User.objects.create_user(email='marks@test.com', name='Тест', password='pass123!A')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.discussion = Discussion.objects.create(
            user=self.user,
            question='Переїжджати заради вищої зарплати?',
            personas=[{'slug': 'logic', 'name': 'Логік'}],
        )
        self.question = self.add('user', 'Переїжджати заради вищої зарплати?')
        self.reply = self.add('ai', 'Зарплата вища на 40%, але оренда з’їсть половину різниці.')

    def add(self, role, content, discussion=None):
        discussion = discussion or self.discussion
        return Message.objects.create(
            discussion=discussion,
            seq=discussion.messages.count() + 1,
            phase='debate',
            role=role,
            persona_slug='logic' if role == 'ai' else 'user',
            persona_name='Логік' if role == 'ai' else 'Тест',
            avatar='',
            content=content,
        )

    def reaction_url(self, message):
        return f'/api/discussions/{message.discussion_id}/messages/{message.pk}/reaction/'

    def highlights_url(self, message):
        return f'/api/discussions/{message.discussion_id}/messages/{message.pk}/highlights/'


class ReactionApiTests(MarksTestCase):
    def test_sets_changes_and_clears_reaction(self):
        response = self.client.put(self.reaction_url(self.reply), {'reaction': 'agree'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['reaction'], 'agree')
        self.reply.refresh_from_db()
        self.assertEqual(self.reply.reaction, 'agree')
        self.assertIsNotNone(self.reply.reaction_at)

        self.client.put(self.reaction_url(self.reply), {'reaction': 'doubt'})
        self.reply.refresh_from_db()
        self.assertEqual(self.reply.reaction, 'doubt')

        self.client.put(self.reaction_url(self.reply), {'reaction': ''})
        self.reply.refresh_from_db()
        self.assertEqual(self.reply.reaction, '')
        self.assertIsNone(self.reply.reaction_at)

    def test_rejects_unknown_reaction(self):
        response = self.client.put(self.reaction_url(self.reply), {'reaction': 'convincing'})
        self.assertEqual(response.status_code, 400)

    def test_own_messages_cannot_be_marked(self):
        response = self.client.put(self.reaction_url(self.question), {'reaction': 'agree'})
        self.assertEqual(response.status_code, 404)
        response = self.client.post(self.highlights_url(self.question), {'quote': 'зарплати'})
        self.assertEqual(response.status_code, 404)

    def test_other_users_messages_are_not_found(self):
        stranger = User.objects.create_user(email='other@test.com', name='Інший', password='pass123!A')
        client = APIClient()
        client.force_authenticate(stranger)
        response = client.put(self.reaction_url(self.reply), {'reaction': 'doubt'})
        self.assertEqual(response.status_code, 404)
        self.reply.refresh_from_db()
        self.assertEqual(self.reply.reaction, '')

    def test_guest_is_rejected(self):
        response = APIClient().put(self.reaction_url(self.reply), {'reaction': 'agree'})
        self.assertIn(response.status_code, (401, 403))


class HighlightApiTests(MarksTestCase):
    def test_creates_updates_and_deletes_highlight(self):
        response = self.client.post(
            self.highlights_url(self.reply),
            {'quote': 'оренда з’їсть половину', 'prefix': 'але ', 'suffix': ' різниці', 'color': 'doubt',
             'note': '  перевірити ціни  '},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['color'], 'doubt')
        self.assertEqual(response.data['note'], 'перевірити ціни')
        highlight_id = response.data['id']

        url = f'/api/discussions/{self.discussion.pk}/highlights/{highlight_id}/'
        response = self.client.patch(url, {'color': 'agree', 'note': ''})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['color'], 'agree')
        self.assertEqual(response.data['note'], '')

        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(Highlight.objects.exists())

    def test_quote_is_required_and_limited(self):
        self.assertEqual(self.client.post(self.highlights_url(self.reply), {'quote': '   '}).status_code, 400)
        response = self.client.post(self.highlights_url(self.reply), {'quote': 'а' * 1001})
        self.assertEqual(response.status_code, 400)

    def test_limit_per_message(self):
        for index in range(HIGHLIGHTS_PER_MESSAGE):
            Highlight.objects.create(message=self.reply, quote=f'фрагмент {index}')
        response = self.client.post(self.highlights_url(self.reply), {'quote': 'ще один'})
        self.assertEqual(response.status_code, 400)

    def test_other_users_highlight_cannot_be_changed(self):
        highlight = Highlight.objects.create(message=self.reply, quote='оренда')
        stranger = User.objects.create_user(email='other@test.com', name='Інший', password='pass123!A')
        client = APIClient()
        client.force_authenticate(stranger)
        url = f'/api/discussions/{self.discussion.pk}/highlights/{highlight.pk}/'
        self.assertEqual(client.patch(url, {'note': 'моє'}).status_code, 404)
        self.assertEqual(client.delete(url).status_code, 404)
        self.assertTrue(Highlight.objects.filter(pk=highlight.pk).exists())


class MarksVisibilityTests(MarksTestCase):
    def setUp(self):
        super().setUp()
        self.reply.reaction = 'important'
        self.reply.save()
        Highlight.objects.create(message=self.reply, quote='оренда', note='особисте')

    def test_author_sees_marks_in_discussion(self):
        data = DiscussionSerializer(self.discussion).data
        reply = next(item for item in data['messages'] if item['id'] == str(self.reply.pk))
        self.assertEqual(reply['reaction'], 'important')
        self.assertEqual(reply['highlights'][0]['quote'], 'оренда')

    def test_shared_link_hides_marks(self):
        data = SharedDiscussionSerializer(self.discussion).data
        for item in data['messages']:
            self.assertNotIn('reaction', item)
            self.assertNotIn('highlights', item)
        self.assertNotIn('особисте', str(data))

    def test_export_contains_marks(self):
        data = export_user(self.user)
        exported = data['discussions'][0]['messages']
        self.assertEqual(exported[-1]['reaction'], 'important')
        self.assertEqual(data['highlights'][0]['quote'], 'оренда')
        self.assertEqual(data['highlights'][0]['message_seq'], self.reply.seq)


class MarksInPromptTests(MarksTestCase):
    def test_reader_marks_describe_reaction_and_highlights(self):
        self.reply.reaction = 'doubt'
        self.reply.save()
        Highlight.objects.create(message=self.reply, quote='оренда з’їсть', color='doubt', note='а комуналка?')
        message = next(m for m in _list_messages(self.discussion) if m.pk == self.reply.pk)
        marks = reader_marks(message)
        self.assertIn('уся репліка: сумнів', marks)
        self.assertIn('«оренда з’їсть»', marks)
        self.assertIn('сумнів', marks)
        self.assertIn('а комуналка?', marks)

    def test_history_explains_marks_only_when_present(self):
        messages = _list_messages(self.discussion)
        prompt = _context_block(self.discussion.question, [], messages, 'open', [], 2)
        self.assertNotIn('позначки людини', prompt)

        self.reply.reaction = 'doubt'
        self.reply.save()
        messages = _list_messages(self.discussion)
        prompt = _context_block(self.discussion.question, [], messages, 'open', [], 2)
        self.assertIn('[позначки людини: уся репліка: сумнів]', prompt)
        self.assertIn('Людина позначала репліки', prompt)

    def test_marks_without_prefetch_do_not_query(self):
        Highlight.objects.create(message=self.reply, quote='оренда')
        plain = Message.objects.get(pk=self.reply.pk)
        with self.assertNumQueries(0):
            self.assertEqual(reader_marks(plain), '')
