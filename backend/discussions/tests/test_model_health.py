"""Пам'ять про збої моделей: квота чи ключ ховають модель на якийсь час."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings

from discussions.models import Discussion
from discussions.services import model_health, runner
from discussions.services.catalog import catalog, user_context
from discussions.services.engine.context import _judge_models, _model_for_persona, _resolved_personas
from discussions.services.providers import ProviderError

from .fakes import FakeProvider
from .test_flow_v3 import KEYS

User = get_user_model()


@override_settings(LLM_COOLDOWN_SECONDS=600, **KEYS)
class ModelHealthTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.provider = FakeProvider()
        self.user = User.objects.create_user(email='health@test.com', name='Оксана', password='pass123!A')

    def make(self):
        discussion = Discussion.objects.create(
            user=self.user, question='Чи варто змінювати роботу?', personas=['logician', 'skeptic'], rounds=2
        )
        discussion.messages.create(
            seq=1, phase=Discussion.Phase.OPENING, role='user', persona_slug='user',
            persona_name='Оксана', avatar='🧑', content=discussion.question,
        )
        return discussion

    def test_quota_failure_moves_the_model_to_the_end_and_marks_it_in_the_catalog(self):
        discussion = self.make()
        broken = _model_for_persona(_resolved_personas(discussion)[0])

        def factory(model_id):
            if model_id == broken:
                raise ProviderError('quota', status=429, quota=True)
            return self.provider

        runner.run(discussion.pk, provider_factory=factory)
        discussion.refresh_from_db()
        self.assertEqual(discussion.phase, Discussion.Phase.DONE)
        self.assertEqual(model_health.down_reason(broken), model_health.QUOTA)

        with user_context(self.user):
            listed = {model['id']: model for model in catalog()['models']}
            self.assertFalse(listed[broken]['available'])
            self.assertEqual(listed[broken]['cooldown'], model_health.QUOTA)
            judges = _judge_models(discussion, _resolved_personas(discussion), 'moderator')
            self.assertEqual(judges[-1], broken)

    def test_cooled_down_own_model_is_tried_last(self):
        discussion = self.make()
        broken = _model_for_persona(_resolved_personas(discussion)[0])
        model_health.mark_down(broken, model_health.KEY)
        calls = []

        def factory(model_id):
            calls.append(model_id)
            return self.provider

        runner.run(discussion.pk, provider_factory=factory)
        own = discussion.messages.filter(persona_slug='logician').values_list('model_id', flat=True)
        self.assertNotIn(broken, set(own))

    def test_nothing_is_remembered_when_cooldown_is_off(self):
        with override_settings(LLM_COOLDOWN_SECONDS=0):
            model_health.mark_down('openai:gpt-test', model_health.QUOTA)
        self.assertEqual(model_health.down_reason('openai:gpt-test'), '')
