"""Промпти для фаз дискусії.

Кожен промпт містить повний контекст: опис проблеми, режим, учасників,
характер і темперамент мовця, додаткові риси та всю історію дискусії.
"""

import json

SYSTEM_BASE = (
    'Ти береш участь у дискусії на платформі Clariti, де кілька AI-персон '
    'обговорюють проблему користувача, сперечаються та шукають найкраще рішення. '
    'Відповідай українською мовою, розгорнуто та по суті (до 220 слів). '
    'Формуй відповідь як 2–4 окремі абзаци: один абзац — одна завершена думка. '
    'Між абзацами залишай порожній рядок. Пиши звичайними реченнями, '
    'без markdown-списків, зірочок і заголовків. '
    'Спирайся на наданий контекст та історію дискусії, не вигадуй фактів. '
    'Не повторюй попередніх співрозмовників: додай новий аргумент, '
    'постав уточнювальне запитання або знайди слабке місце в чужій ідеї. '
    'Критикуй ідеї, а не людей.'
)

DEVIL_SYSTEM = (
    'Ти — AI Devil. Твоя єдина задача — знайти слабкі місця в запропонованому рішенні: '
    'ризики, помилки, приховані припущення, контраргументи. '
    'Будь прямим і невблаганним, але аргументованим. '
    'Не вигадуй фактів і спирайся на повну історію дискусії. Відповідай українською.'
)

MODERATOR_SYSTEM = (
    'Ти — Модератор Clariti. Після дискусії AI-персон ти пропонуєш найкраще рішення '
    'і фінальний підсумок для користувача. Враховуй усі аргументи, характер учасників '
    'і критику AI Devil. Відповідай українською, чесно та зважено, без markdown.'
)


def mode_block(mode, options):
    if mode == 'yes_no':
        return (
            'Режим дискусії: «Так або ні».\n'
            'Висновок дискусії має бути однозначним: ТАК або НІ.'
        )
    if mode == 'choose_one':
        variants = '; '.join(options or [])
        return (
            'Режим дискусії: «Один із варіантів».\n'
            f'Варіанти: {variants}\n'
            'Висновок має чітко обрати один із них.'
        )
    return 'Режим дискусії: «Вільна відповідь» (генеративний висновок).'


def _persona_block(persona):
    lines = [
        f'Ім’я: {persona.get("name", "Учасник")}',
        f'Темперамент: {persona.get("temperament", "не задано")}',
        f'Опис: {persona.get("description", "не задано")}',
        f'Базовий характер: {persona.get("style", "не задано")}',
    ]
    if persona.get('custom_style'):
        lines.append(f'Додатковий стиль від користувача: {persona["custom_style"]}')
    traits = persona.get('traits') or []
    if traits:
        lines.append(f'Додаткові риси: {", ".join(traits)}')
    else:
        lines.append('Додаткові риси: не вибрано')
    return '\n'.join(lines)


def _participants_block(personas):
    lines = []
    for persona in personas:
        traits = persona.get('traits') or []
        traits_text = f'; риси: {", ".join(traits)}' if traits else ''
        lines.append(
            f'- {persona.get("name", "Учасник")} — '
            f'{persona.get("temperament", "без темпераменту")}. '
            f'{persona.get("description", "")}{traits_text}'
        )
    return '\n'.join(lines)


def _history_block(messages):
    lines = []
    for message in messages:
        round_prefix = f'[Раунд {message.round}] ' if message.round else ''
        lines.append(
            f'{round_prefix}{message.persona_name} ({message.role}): {message.content}'
        )
    return '\n'.join(lines) if lines else '(поки що без повідомлень)'


def _context_block(question, personas, messages, mode, options, rounds, current_round=None):
    lines = [
        'Опис проблеми / запитання користувача:',
        question,
        '',
        mode_block(mode, options or []),
        f'Заплановано раундів дискусії: {rounds}',
    ]
    if current_round is not None:
        lines.append(f'Поточний раунд: {current_round} з {rounds}')
    lines.extend(
        [
            '',
            'Учасники дискусії:',
            _participants_block(personas),
            '',
            'Повна історія дискусії:',
            _history_block(messages),
        ]
    )
    return '\n'.join(lines)


def opening_prompt(
    question, persona, personas, messages, mode='open', options=None, rounds=2
):
    context = _context_block(
        question, personas, messages, mode, options or [], rounds
    )
    return (
        f'{context}\n\n'
        'Твоя роль:\n'
        f'{_persona_block(persona)}\n\n'
        'Дай початкову позицію щодо проблеми (2–3 абзаци). '
        'У першому абзаці сформулюй тезу, у другому — обґрунтуй її, '
        'у третьому — назви головне, що потрібно перевірити. '
        'Відокрем абзаци порожнім рядком.'
    )


def debate_prompt(
    question,
    persona,
    personas,
    messages,
    debate_round,
    mode='open',
    options=None,
    rounds=2,
):
    context = _context_block(
        question, personas, messages, mode, options or [], rounds, debate_round
    )
    return (
        f'{context}\n\n'
        'Твоя роль:\n'
        f'{_persona_block(persona)}\n\n'
        'Продовжи дискусію (2–3 абзаци): відреагуй на конкретні аргументи інших '
        'учасників, погодься або посперечайся, наведи новий аргумент і знайди '
        'слабке місце в чужій ідеї. Кожну думку оформи окремим абзацом '
        'з порожнім рядком між ними. Не повторюй уже сказане.'
    )


def synthesis_prompt(
    question,
    personas,
    moderator,
    messages,
    mode='open',
    options=None,
    rounds=2,
):
    if mode == 'yes_no':
        answer_schema = '"answer": "так" або "ні", '
    elif mode == 'choose_one':
        variants = '; '.join(options or [])
        answer_schema = f'"answer": "один із варіантів ({variants})", '
    else:
        answer_schema = ''
    context = _context_block(
        question, personas, messages, mode, options or [], rounds
    )
    return (
        f'{context}\n\n'
        'Твоя роль:\n'
        f'{_persona_block(moderator)}\n\n'
        'На основі аргументів усіх учасників запропонуй найкращий варіант рішення. '
        'Відповідай СУВОРО одним JSON-об’єктом без пояснень поза JSON:\n'
        f'{{{answer_schema}"decision": "суть рішення", "reasoning": "чому саме воно", '
        '"supporting_arguments": ["аргумент"], "dissenting_points": ["непогоджена теза"]}'
    )


def devil_prompt(
    question,
    personas,
    devil,
    best_solution,
    messages,
    mode='open',
    options=None,
    rounds=2,
):
    context = _context_block(
        question, personas, messages, mode, options or [], rounds
    )
    solution = json.dumps(best_solution or {}, ensure_ascii=False)
    return (
        f'{context}\n\n'
        'Твоя роль:\n'
        f'{_persona_block(devil)}\n\n'
        f'Запропоноване рішення (JSON): {solution}\n\n'
        'Спробуй довести, що це рішення неправильне або ризикове. '
        'Відповідай СУВОРО одним JSON-об’єктом:\n'
        '{"verdict": "короткий вердикт", '
        '"risks": [{"title": "назва", "description": "опис", '
        '"severity": "низька|середня|висока"}], '
        '"weak_spots": ["слабке місце"], '
        '"counter_arguments": ["контраргумент"]}'
    )


def final_prompt(
    question,
    personas,
    moderator,
    best_solution,
    devil_review,
    messages,
    mode='open',
    options=None,
    rounds=2,
):
    if mode == 'yes_no':
        answer_schema = '"answer": "так" або "ні", '
    elif mode == 'choose_one':
        variants = '; '.join(options or [])
        answer_schema = f'"answer": "один із варіантів ({variants})", '
    else:
        answer_schema = ''
    context = _context_block(
        question, personas, messages, mode, options or [], rounds
    )
    solution = json.dumps(best_solution or {}, ensure_ascii=False)
    review = json.dumps(devil_review or {}, ensure_ascii=False)
    return (
        f'{context}\n\n'
        'Твоя роль:\n'
        f'{_persona_block(moderator)}\n\n'
        f'Рішення після дискусії (JSON): {solution}\n'
        f'Критика AI Devil (JSON): {review}\n\n'
        'Після критики AI Devil виріши: чи витримує висновок перевірку. '
        'Якщо аргументи Devil незначні — підтверди висновок (confirmed: true). '
        'Якщо Devil знайшов серйозні слабкі місця — перегляни висновок '
        '(confirmed: false, у decision — виправлений варіант, '
        'у revision — що саме змінилось). '
        'Відповідай СУВОРО одним JSON-об’єктом:\n'
        f'{{{answer_schema}"decision": "фінальне рішення", '
        '"confirmed": true або false, '
        '"revision": "що змінилось після Devil (порожнє, якщо підтверджено)", '
        '"pros": ["перевага"], "cons": ["недолік"], "risks": ["ризик"], '
        '"confidence": 0-100, "recommendation": "що робити далі"}'
    )
