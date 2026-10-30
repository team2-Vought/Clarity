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

    def __init__(self, stance=None, search_query=None, clarify_questions=None):
        self.calls = []
        self.counter = 0
        self.stance = stance
        self.search_query = search_query
        self.clarify_questions = clarify_questions or []
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
            if '"ready"' in prompt:
                return json.dumps(
                    {'ready': not self.clarify_questions, 'questions': self.clarify_questions},
                    ensure_ascii=False,
                )
            if '"confirmed"' in prompt:
                return json.dumps(self._final(prompt), ensure_ascii=False)
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
        }
        answer = self._answer(prompt)
        if answer:
            data['answer'] = answer
        return data
