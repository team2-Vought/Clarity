import json


class FakeProvider:
    """Детермінований провайдер для тестів; не використовується в production."""

    def __init__(self):
        self.calls = []
        self.counter = 0

    def complete(self, *, system, prompt, temperature=0.7):
        self.calls.append(
            {
                'system': system,
                'prompt': prompt,
                'temperature': temperature,
            }
        )
        if '"confirmed"' in prompt:
            return json.dumps(self._final(prompt), ensure_ascii=False)
        if '"verdict"' in prompt:
            return json.dumps(self._devil(), ensure_ascii=False)
        if '"supporting_arguments"' in prompt:
            return json.dumps(self._synthesis(prompt), ensure_ascii=False)
        self.counter += 1
        return f'Тестова репліка #{self.counter}. Аргумент для перевірки контексту.'

    def _answer(self, prompt):
        if '«Так або ні»' in prompt:
            return 'так'
        if '«Один із варіантів»' in prompt:
            for line in prompt.splitlines():
                if line.startswith('Варіанти:'):
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
            'confidence': 80,
            'recommendation': 'Тестова рекомендація',
        }
        answer = self._answer(prompt)
        if answer:
            data['answer'] = answer
        return data
