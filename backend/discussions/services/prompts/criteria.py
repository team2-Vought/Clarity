"""Критерії людини для «Один із варіантів»: учасники оцінюють варіанти, судді
бачать підсумкову матрицю."""

import json

from backend.i18n import L

from .common import _inline
from .context import _context_block, _speaker_line

SCORE_MIN, SCORE_MAX = 1, 10


def _criteria_lines(criteria):
    return '\n'.join(
        f'- {_inline(item["name"])} ' + L(f'(вага {item["weight"]} з 5)', f'(weight {item["weight"]} of 5)')
        for item in criteria
    )


def scoring_prompt(question, persona, personas, messages, criteria, mode='choose_one', options=None, **context):
    """Учасник ставить кожному варіанту бал за кожним критерієм — через призму свого характеру."""
    options = options or []
    ctx = _context_block(question, personas, messages, mode, options, context.pop('rounds', 2), **context)
    example = {option: {item['name']: 7 for item in criteria} for option in options[:1]}
    return '\n\n'.join([
        ctx,
        _speaker_line(persona),
        L('Критерії, які назвала людина, і їхня вага для неї:', 'The criteria the person named and their weight for them:'),
        _criteria_lines(criteria),
        L(
            f'Оціни кожен варіант за кожним критерієм від {SCORE_MIN} до {SCORE_MAX} — так, як '
            'бачиш саме ти після дискусії, через призму свого характеру. Оцінюй чесно й '
            'відносно: якщо варіанти відрізняються, бали теж мають відрізнятися. У comment — '
            'одне речення: що найбільше вплинуло на твої оцінки.',
            f'Score every option on every criterion from {SCORE_MIN} to {SCORE_MAX} — as you see it '
            'after the discussion, through the lens of your character. Score honestly and '
            'relatively: if the options differ, the scores must differ too. In comment — one '
            'sentence: what influenced your scores most.',
        ),
        L(
            'Відповідай СУВОРО одним JSON-об’єктом, назви варіантів і критеріїв — дослівно:\n',
            'Reply STRICTLY with a single JSON object, option and criterion names verbatim:\n',
        ) + json.dumps({'scores': example, 'comment': '…'}, ensure_ascii=False),
    ])


def matrix_block(matrix):
    """Матриця для суддів: середні бали учасників і підсумок з урахуванням ваги."""
    if not matrix or not matrix.get('rows'):
        return ''
    names = [item['name'] for item in matrix['criteria']]
    lines = []
    for row in matrix['rows']:
        cells = ', '.join(
            f'{name}: {score if score is not None else "—"}' for name, score in zip(names, row['scores'])
        )
        lines.append(f'- {_inline(row["option"])} — {cells}; ' + L('підсумок', 'total') + f' {row["total"]}')
    return '\n'.join([
        L(
            'Матриця критеріїв людини: середні оцінки учасників від 1 до 10, підсумок — '
            'з урахуванням ваги кожного критерію:',
            'The person’s criteria matrix: participants’ average scores from 1 to 10, the total '
            'takes the weight of each criterion into account:',
        ),
        _criteria_lines(matrix['criteria']),
        *lines,
        L(
            'Спирайся на матрицю, але рішення — за аргументами. Якщо обираєш не лідера '
            'матриці, прямо поясни чому.',
            'Rely on the matrix, but the decision follows the arguments. If you choose an '
            'option that does not lead the matrix, explain why directly.',
        ),
    ])
