from django.test import SimpleTestCase

from discussions.personas import trait_guidance
from discussions.services import prompts

PERSONA = {'name': 'Бунтар', 'traits': ['Бунтар', 'Провокатор']}
PERSONAS = [PERSONA, {'name': 'Логік'}]


class PromptGuardrailTests(SimpleTestCase):
    def test_limits_close_the_persona_system_prompt(self):
        system = prompts.persona_system(PERSONA)
        # межі стоять після характеру, щоб риси їх не переважили
        self.assertGreater(
            system.index('Межі, яких не скасовують'),
            system.index('Правила характеру:'),
        )
        self.assertIn('Симетрія доказів', system)
        self.assertIn('Не приписуй іншим учасникам', system)
        self.assertIn(prompts.SAFETY_RULE, system)

    def test_judges_follow_the_safety_rule(self):
        self.assertIn(prompts.SAFETY_RULE, prompts.DEVIL_SYSTEM)
        self.assertIn(prompts.SAFETY_RULE, prompts.MODERATOR_SYSTEM)

    def test_rebel_trait_keeps_safety_and_respect(self):
        guidance = trait_guidance('Бунтар')
        self.assertIn('не проти людей', guidance)
        self.assertIn('Правила безпеки', guidance)

    def test_length_rule_comes_right_before_service_lines(self):
        cases = {
            'opening': prompts.opening_prompt('Питання', PERSONA, PERSONAS),
            'debate': prompts.debate_prompt('Питання', PERSONA, PERSONAS, [], 1),
            'rebuttal': prompts.rebuttal_prompt('Питання', PERSONA, PERSONAS, []),
        }
        for phase, prompt in cases.items():
            with self.subTest(phase=phase):
                rule = prompts.length_rule(phase)
                self.assertIn(rule, prompt)
                self.assertLess(prompt.index(rule), prompt.index('ТЕЗА:'))
