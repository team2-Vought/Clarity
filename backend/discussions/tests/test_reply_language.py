from django.test import SimpleTestCase

from backend.i18n import using
from discussions.services import reply_language
from discussions.services.engine.calls import _complete


class DetectTests(SimpleTestCase):
    def test_common_languages(self):
        cases = {
            'Should I quit my job to start a coffee shop?': 'en',
            'Чи варто мені звільнятися, щоб відкрити кав’ярню?': 'uk',
            'Стоит ли мне увольняться, чтобы открыть кофейню?': 'ru',
            'Czy warto rzucić pracę i otworzyć kawiarnię?': 'pl',
            'Soll ich meinen Job kündigen und ein Café eröffnen?': 'de',
            '¿Debo dejar mi trabajo para abrir una cafetería?': 'es',
            'Dois-je quitter mon travail pour ouvrir un café ?': 'fr',
            'Devo lasciare il mio lavoro per aprire un bar?': 'it',
            '仕事を辞めてカフェを開くべきですか？': 'ja',
            '我应该辞职开咖啡店吗？': 'zh',
        }
        for question, code in cases.items():
            with self.subTest(question=question):
                self.assertEqual(reply_language.detect(question), code)

    def test_the_clarifications_heading_in_the_interface_language_is_ignored(self):
        question = 'Should I move to Berlin?\n\nУточнення від користувача:\n- Budget? — 2000 EUR'
        self.assertEqual(reply_language.detect(question), 'en')

    def test_full_clarifications_block_is_ignored(self):
        from backend.i18n import using
        from discussions.services.prompts import question_with_clarifications

        with using('uk'):
            question = question_with_clarifications(
                'Should I learn Rust or Go next?',
                [{'question': 'Чи планує компанія перейти на одну з мов?', 'answer': 'Ні, жодної'}],
            )
        self.assertIn('Відповідь людини: Ні, жодної', question)
        self.assertEqual(reply_language.detect(question), 'en')

    def test_unsure_means_no_instruction(self):
        self.assertEqual(reply_language.detect('42?'), '')
        with reply_language.replying_to('42?'):
            self.assertEqual(reply_language.instruction(), '')


class _Recorder:
    def __init__(self):
        self.systems = []

    def complete(self, *, system, prompt, temperature=0.7, json_mode=False):
        self.systems.append(system)
        return 'ok'


class InstructionTests(SimpleTestCase):
    def test_models_are_told_the_users_language_in_the_interface_language(self):
        recorder = _Recorder()
        with using('uk'), reply_language.replying_to('Should I quit my job?'):
            _complete(lambda model_id: recorder, 'm', 'Система', 'Промпт')
            # рядок статусу — частина інтерфейсу: без вказівки про мову людини
            _complete(lambda model_id: recorder, 'm', 'Статус', 'Промпт', reply_in_user_language=False)
        self.assertIn('Мова відповіді — англійською', recorder.systems[0])
        self.assertEqual(recorder.systems[1], 'Статус')

        with using('en'), reply_language.replying_to('Чи варто мені звільнятися?'):
            _complete(lambda model_id: recorder, 'm', 'System', 'Prompt')
        self.assertIn('Reply language — Ukrainian', recorder.systems[2])
