"""Матриця критеріїв для «Один із варіантів».

Людина задає критерії й вагу кожного (1–5). Після дебатів кожен учасник
ставить варіантам бали 1–10 за кожним критерієм; середні бали з урахуванням
ваги дають підсумок — так видно, чому переміг саме цей варіант.
"""

CRITERIA_MAX = 6
NAME_MAX = 60
WEIGHT_MIN, WEIGHT_MAX = 1, 5
SCORE_MIN, SCORE_MAX = 1, 10


def _fold(value):
    return ' '.join(str(value or '').split()).casefold()


def _score(value):
    try:
        number = round(float(value))
    except (TypeError, ValueError):
        return None
    return max(SCORE_MIN, min(SCORE_MAX, number))


def normalize_scores(data, options, criteria):
    """{option: {criterion: 1–10}} із відповіді моделі; назви — як у людини.

    Модель могла змінити регістр чи пробіли в назвах — зіставляємо без них."""
    data = data if isinstance(data, dict) else {}
    raw = data.get('scores') if isinstance(data.get('scores'), dict) else {}
    by_option = {_fold(key): value for key, value in raw.items()}
    result = {}
    for option in options:
        row = by_option.get(_fold(option))
        row = row if isinstance(row, dict) else {}
        by_criterion = {_fold(key): value for key, value in row.items()}
        result[option] = {
            item['name']: _score(by_criterion.get(_fold(item['name']))) for item in criteria
        }
    comment = ' '.join(str(data.get('comment') or '').split())[:300]
    return {'scores': result, 'comment': comment}


def scoring_problems(data, options, criteria):
    """Чого бракує у відповіді: хоча б половина клітинок має бути заповнена."""
    if not isinstance(data, dict) or not isinstance(data.get('scores'), dict):
        return ['поле "scores" має бути об’єктом {варіант: {критерій: бал}}']
    filled = normalize_scores(data, options, criteria)['scores']
    cells = [score for row in filled.values() for score in row.values()]
    if sum(score is not None for score in cells) * 2 < len(cells):
        return ['бракує оцінок: для кожного варіанта й критерію потрібен бал 1–10']
    return []


def compute_matrix(criteria, options, scores):
    """Середні бали учасників і зважений підсумок; лідер — найвищий підсумок.

    `scores` — {slug учасника: {'scores': {option: {criterion: бал}}, 'comment'}}."""
    if not criteria or not options:
        return None
    total_weight = sum(item['weight'] for item in criteria) or 1
    rows = []
    for option in options:
        averages = []
        for item in criteria:
            values = [
                entry['scores'].get(option, {}).get(item['name'])
                for entry in scores.values()
                if isinstance(entry, dict) and isinstance(entry.get('scores'), dict)
            ]
            values = [value for value in values if value is not None]
            averages.append(round(sum(values) / len(values), 1) if values else None)
        weighted = sum(
            (average if average is not None else 0) * item['weight']
            for average, item in zip(averages, criteria)
        )
        rows.append({'option': option, 'scores': averages, 'total': round(weighted / total_weight, 1)})
    best = max((row['total'] for row in rows), default=0)
    leaders = [row['option'] for row in rows if row['total'] == best]
    return {
        'criteria': criteria,
        'rows': rows,
        # нічия — без переможця: тоді вирішують аргументи
        'winner': leaders[0] if len(leaders) == 1 and best > 0 else '',
        'participants': len(scores),
    }
