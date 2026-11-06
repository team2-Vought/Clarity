import json
import threading


class FakeProvider:
    """Детермінований провайдер для тестів; не використовується в production.

    `stance` — значення службового рядка ПОЗИЦІЯ у репліках учасників
    (None — рядок не додається, тож консенсус ніколи не настає).
    `search_query` — службовий рядок ПОШУК у першій репліці, де пошук дозволено.
    `clarify_questions` — уточнювальні питання модератора перед стартом
    (порожньо — контексту досить).
    """

    def __init__(self, stance=None, search_query=None, clarify_questions=None, topic='none'):
        self.calls = []
        self.counter = 0
        self.stance = stance
        self.search_query = search_query
        self.clarify_questions = clarify_questions or []
        # тема, яку «розпізнає» модератор: crisis / medical / legal / financial / none
        self.topic = topic
        # оцінки за критеріями: {варіант: {критерій: бал}}
        self.scores_reply = {}
        # відповідь на запит дерева рішень; None — типове дерево з двох гілок
        self.tree_reply = None
        self._lock = threading.Lock()

    def complete(self, *, system, prompt, temperature=0.7, json_mode=False):
        with self._lock:
            self.calls.append(
                {
                    'system': system,
                    'prompt': prompt,
                    'temperature': temperature,
                    'json_mode': json_mode,
                }
            )
            if '"branches"' in prompt:
                return json.dumps(self.tree_reply or self._tree(), ensure_ascii=False)
            if '"ready"' in prompt:
                return json.dumps(
                    {
                        'ready': not self.clarify_questions,
                        'questions': self.clarify_questions,
                        'topic': self.topic,
                    },
                    ensure_ascii=False,
                )
            if '"confirmed"' in prompt:
                return json.dumps(self._final(prompt), ensure_ascii=False)
            if '"scores"' in prompt:
                return json.dumps({'scores': self.scores_reply, 'comment': 'Оцінив'}, ensure_ascii=False)
            if '"topic"' in prompt:
                data = {
                    'decision': 'Швидке рішення',
                    'next_steps': ['Зробити перший крок'],
                    'change_triggers': [],
                    'confidence': 70,
                    'topic': self.topic,
                }
                answer = self._answer(prompt)
                if answer:
                    data['answer'] = answer
                return json.dumps(data, ensure_ascii=False)
            if '"verdict"' in prompt:
                return json.dumps(self._devil(), ensure_ascii=False)
            if '"supporting_arguments"' in prompt:
                return json.dumps(self._synthesis(prompt), ensure_ascii=False)
            self.counter += 1
            lines = [
                f'Тестова репліка #{self.counter}. Аргумент для перевірки контексту.',
                '',
                f'ТЕЗА: Теза репліки #{self.counter}',
            ]
            if self.stance:
                lines.append(f'ПОЗИЦІЯ: {self.stance}')
            if self.search_query and 'ПОШУК:' in prompt:
                lines.append(f'ПОШУК: {self.search_query}')
                self.search_query = None
            return '\n'.join(lines)

    def _answer(self, prompt):
        if '«Так або ні»' in prompt:
            return 'так'
        if '“Yes or no”' in prompt:
            return 'yes'
        if '«Один із варіантів»' in prompt or '“One of the options”' in prompt:
            for line in prompt.splitlines():
                if line.startswith(('Варіанти:', 'Options:')):
                    options = [
                        item.strip()
                        for item in line.split(':', 1)[1].split(';')
                        if item.strip()
                    ]
                    if options:
                        return options[0]
        return None

    def _tree(self):
        return {
            'root': 'Чи переходити на нову роботу?',
            'branches': [
                {
                    'title': 'Перейти зараз',
                    'status': 'chosen',
                    'summary': 'Більша зарплата важить більше за ризик.',
                    'fit': 78,
                    'supporters': ['Логік'],
                    'pros': ['Зарплата +30%'],
                    'cons': ['Випробувальний термін'],
                    'why': 'Логік показав, що подушки вистачить на пів року.',
                    'outcomes': [
                        {'condition': 'Якщо пройдете випробувальний', 'result': 'Стабільний ріст', 'tone': 'good'},
                    ],
                },
                {
                    'title': 'Лишитися',
                    'status': 'alternative',
                    'summary': 'Спокійно, але без росту.',
                    'fit': 45,
                    'supporters': ['Скептик'],
                    'pros': ['Без ризику'],
                    'cons': ['Зарплата не росте'],
                    'why': 'Програло через відсутність росту.',
                    'outcomes': [],
                },
            ],
            'path': [
                {'stage': 'question', 'title': 'Питання', 'text': 'Чи переходити?', 'who': ''},
                {'stage': 'turn', 'title': 'Подушка', 'text': 'Грошей вистачить.', 'who': 'Логік'},
                {'stage': 'conclusion', 'title': 'Висновок', 'text': 'Переходити.', 'who': 'Модератор'},
            ],
        }

    def _synthesis(self, prompt):
        data = {
            'decision': 'Тестове рішення',
            'reasoning': 'Тестове обґрунтування',
            'supporting_arguments': ['Тестовий аргумент'],
            'dissenting_points': [],
        }
        answer = self._answer(prompt)
        if answer:
            data['answer'] = answer
        return data

    def _devil(self):
        return {
            'verdict': 'Тестовий вердикт',
            'risks': [],
            'weak_spots': [],
            'counter_arguments': [],
        }

    def _final(self, prompt):
        data = {
            'decision': 'Тестове фінальне рішення',
            'confirmed': True,
            'revision': '',
            'pros': ['Тестова перевага'],
            'cons': [],
            'risks': [],
            'dissenting_points': [],
            'confidence': 80,
            'recommendation': 'Тестова рекомендація',
            'next_steps': ['Порахувати бюджет на місяць', 'Поговорити з керівником'],
            'change_triggers': ['Якщо зарплата буде меншою за обіцяну — переглянути рішення'],
        }
        answer = self._answer(prompt)
        if answer:
            data['answer'] = answer
        return data
