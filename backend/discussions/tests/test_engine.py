from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from discussions.models import Discussion, Message
from discussions.services import engine

User = get_user_model()


@override_settings(LLM_PROVIDER='mock')
class EngineTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email='engine@test.com', name='Тест', password='pass123!A'
        )
        self.discussion = Discussion.objects.create(
            user=self.user,
            question='Чи варто змінювати роботу на стартап?',
            personas=['logician', 'skeptic', 'creative'],
            rounds=2,
        )
        self.discussion.messages.create(
            seq=1,
            phase=Discussion.Phase.OPENING,
            role=Message.Role.USER,
            persona_slug='user',
            persona_name='Тест',
            avatar='🧑',
            content=self.discussion.question,
        )

    def run_to_completion(self):
        created = 0
        while True:
            message = engine.advance(self.discussion)
            self.discussion.refresh_from_db()
            if message is None:
                break
            created += 1
            self.assertLess(created, 50, 'движок не завершується')
        return created

    def test_full_flow_creates_all_phases(self):
        created = self.run_to_completion()

        self.assertEqual(self.discussion.phase, Discussion.Phase.DONE)
        self.assertEqual(self.discussion.status, Discussion.Status.DONE)
        self.assertIsNotNone(self.discussion.best_solution)
        self.assertIsNotNone(self.discussion.devil_review)
        self.assertIsNotNone(self.discussion.final_summary)
        self.assertIsNotNone(self.discussion.finished_at)
        self.assertIn('confirmed', self.discussion.final_summary)

        phases = set(self.discussion.messages.values_list('phase', flat=True))
        self.assertEqual(
            phases,
            {
                Discussion.Phase.OPENING,
                Discussion.Phase.DEBATE,
                Discussion.Phase.SYNTHESIS,
                Discussion.Phase.DEVIL,
                Discussion.Phase.FINAL,
            },
        )
        # user msg + 3 opening + 3*2 debate + synthesis + devil + final
        self.assertEqual(created, 12)
        self.assertEqual(self.discussion.messages.count(), 1 + created)

    def test_messages_have_sequential_unique_seq(self):
        self.run_to_completion()
        seqs = list(self.discussion.messages.order_by('seq').values_list('seq', flat=True))
        self.assertEqual(seqs, list(range(1, len(seqs) + 1)))

    def test_devil_message_present(self):
        self.run_to_completion()
        devil = self.discussion.messages.filter(role=Message.Role.DEVIL).first()
        self.assertIsNotNone(devil)
        self.assertTrue(devil.content.strip())

    def test_advance_after_done_returns_none(self):
        self.run_to_completion()
        self.assertIsNone(engine.advance(self.discussion))

    def test_failed_discussion_raises(self):
        self.discussion.status = Discussion.Status.FAILED
        self.discussion.save()
        with self.assertRaises(engine.EngineError):
            engine.advance(self.discussion)

    def test_persona_overrides_used(self):
        self.discussion.personas = [
            {'slug': 'logician', 'style': 'Ти — космічний аналітик.', 'temperature': 0.2},
            {'slug': 'skeptic'},
            {'slug': 'creative'},
        ]
        self.discussion.save()
        self.run_to_completion()
        opening = self.discussion.messages.filter(phase=Discussion.Phase.OPENING).first()
        self.assertTrue(opening.content.strip())

    def test_yes_no_mode_flow(self):
        self.discussion.mode = Discussion.Mode.YES_NO
        self.discussion.save()
        self.run_to_completion()
        self.assertEqual(self.discussion.final_summary.get('answer'), 'так')
        self.assertIn('confirmed', self.discussion.final_summary)

    def test_choose_one_mode_flow(self):
        self.discussion.mode = Discussion.Mode.CHOOSE_ONE
        self.discussion.options = ['Купити', 'Не купувати', 'Зачекати']
        self.discussion.save()
        self.run_to_completion()
        self.assertEqual(
            self.discussion.best_solution.get('answer'),
            'Купити',
        )
        self.assertEqual(self.discussion.final_summary.get('answer'), 'Купити')
