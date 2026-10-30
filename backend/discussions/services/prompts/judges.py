"""Промпти суддів: рішення модератора, перевірка AI Devil, фінальний висновок."""

import json

from backend.i18n import L

from .context import _context_block


def _answer_schema(mode, options):
    if mode == 'yes_no':
        return L('"answer": "так" або "ні", ', '"answer": "yes" or "no", ')
    if mode == 'choose_one':
        variants = '; '.join(options or [])
        return L(
            f'"answer": "дослівно один із варіантів ({variants})", ',
            f'"answer": "exactly one of the options ({variants})", ',
        )
    return ''


def _answer_rule(mode):
    if mode == 'yes_no':
        return L(
            'Поле answer обов’язкове: рівно "так" або "ні", без розмітки. ',
            'The answer field is required: exactly "yes" or "no", without markup. ',
        )
    if mode == 'choose_one':
        return L(
            'Поле answer обов’язкове: дослівно один із варіантів, без змін і розмітки. ',
            'The answer field is required: exactly one of the options, word for word, '
            'without changes or markup. ',
        )
    return ''


SOURCES_RULE = (
    'Якщо спираєшся на факт із джерел, познач його номером [n]. '
    'Не вигадуй джерел, яких немає в списку. '
)

SOURCES_RULE_EN = (
    'If you rely on a fact from the sources, mark it with its number [n]. '
    'Do not invent sources that are not on the list. '
)

USER_NOTES_RULE = (
    'Уточнення користувача в історії (роль «користувач») мають найвищий '
    'пріоритет: рішення має відповідати саме на них. '
)

USER_NOTES_RULE_EN = (
    'The user’s clarifications in the history (role “user”) have the highest '
    'priority: the solution must answer exactly them. '
)


def _rules(sources):
    """Правила про уточнення користувача й джерела перед JSON-схемою."""
    notes = L(USER_NOTES_RULE, USER_NOTES_RULE_EN)
    return notes + (L(SOURCES_RULE, SOURCES_RULE_EN) if sources else '')


def synthesis_prompt(
    question,
    personas,
    messages,
    mode='open',
    options=None,
    rounds=2,
    consensus=False,
    early_stop=False,
    sources=None,
):
    ctx = _context_block(
        question, personas, messages, mode, options or [], rounds,
        sources=sources,
        consensus=consensus,
    )
    if early_stop:
        early = L(
            'Учасники дійшли згоди раніше запланованого, тому дискусію завершено '
            'достроково.\n',
            'The participants reached agreement earlier than planned, so the '
            'discussion ended early.\n',
        )
    else:
        early = ''
    task = L(
        'На основі аргументів усіх учасників запропонуй найкращий варіант рішення. '
        'Зважуй силу аргументів, а не кількість голосів і не порядок виступів. '
        'Якщо учасники розійшлися, обери позицію з найсильнішим обґрунтуванням '
        'і поясни, чому не іншу. Не склеюй усі думки в компроміс, якщо він гірший '
        'за одну з позицій. У decision — що саме зробити і за яких умов; '
        'reasoning — 2–4 речення про те, що переважило. '
        'У reasoning посилайся на конкретних учасників за іменами, які дав '
        'користувач, і на їхні реальні тези з історії. '
        'У dissenting_points перелічи позиції меншості та тези, щодо яких '
        'згоди не досягнуто, із зазначенням, хто їх відстоює. ',
        'Based on the arguments of all participants, propose the best solution. '
        'Weigh the strength of arguments, not the number of votes or the speaking '
        'order. If the participants disagreed, choose the position with the '
        'strongest justification and explain why not the other. Do not glue all '
        'views into a compromise if it is worse than one of the positions. In '
        'decision — what exactly to do and under what conditions; reasoning — '
        '2–4 sentences on what tipped the balance. '
        'In reasoning refer to specific participants by the names the user gave '
        'them and to their actual points from the history. '
        'In dissenting_points list the minority positions and the points on which '
        'no agreement was reached, noting who holds them. ',
    )
    schema = L(
        'Відповідай СУВОРО одним JSON-об’єктом без пояснень поза JSON:\n'
        f'{{{_answer_schema(mode, options)}"decision": "суть рішення", '
        '"reasoning": "чому саме воно", '
        '"supporting_arguments": ["аргумент"], "dissenting_points": ["непогоджена теза"]}',
        'Reply STRICTLY with a single JSON object, with no explanations outside the JSON:\n'
        f'{{{_answer_schema(mode, options)}"decision": "the essence of the solution", '
        '"reasoning": "why this one", '
        '"supporting_arguments": ["argument"], "dissenting_points": ["point without agreement"]}',
    )
    return f'{ctx}\n\n{early}{task}{_rules(sources)}{_answer_rule(mode)}{schema}'


def devil_prompt(
    question,
    personas,
    best_solution,
    messages,
    mode='open',
    options=None,
    rounds=2,
    consensus=False,
    sources=None,
    can_search=False,
):
    ctx = _context_block(
        question, personas, messages, mode, options or [], rounds,
        sources=sources,
        consensus=consensus,
    )
    solution = json.dumps(best_solution or {}, ensure_ascii=False)
    search_rule = ''
    search_field = ''
    if can_search:
        search_rule = L(
            'Якщо рішення спирається на факти, які варто перевірити, додай до 2 '
            'пошукових запитів у search_queries — знайдені джерела побачать '
            'учасники й модератор. ',
            'If the solution relies on facts worth checking, add up to 2 search '
            'queries in search_queries — the participants and the moderator will '
            'see the sources found. ',
        )
        search_field = L(
            ', "search_queries": ["запит для перевірки"]',
            ', "search_queries": ["query to check"]',
        )
    return L(
        f'{ctx}\n\n'
        f'Запропоноване рішення (JSON): {solution}\n\n'
        'Спробуй довести, що це рішення неправильне або ризикове. '
        'Не повторюй заперечень, які учасники вже обговорили й закрили, — '
        'шукай те, що пропустили. У description кожного ризику поясни, як він '
        'спрацює і як його перевірити чи знизити. '
        f'{search_rule}'
        'Відповідай СУВОРО одним JSON-об’єктом:\n'
        '{"verdict": "короткий вердикт", '
        '"risks": [{"title": "назва", "description": "опис", '
        '"severity": "низька|середня|висока"}], '
        '"weak_spots": ["слабке місце"], '
        f'"counter_arguments": ["контраргумент"]{search_field}}}',
        f'{ctx}\n\n'
        f'Proposed solution (JSON): {solution}\n\n'
        'Try to prove that this solution is wrong or risky. '
        'Do not repeat objections the participants have already discussed and '
        'settled — look for what they missed. In the description of each risk '
        'explain how it would play out and how to check or reduce it. '
        f'{search_rule}'
        'Reply STRICTLY with a single JSON object:\n'
        '{"verdict": "a short verdict", '
        '"risks": [{"title": "title", "description": "description", '
        '"severity": "low|medium|high"}], '
        '"weak_spots": ["weak spot"], '
        f'"counter_arguments": ["counterargument"]{search_field}}}',
    )


def final_prompt(
    question,
    personas,
    best_solution,
    devil_review,
    messages,
    mode='open',
    options=None,
    rounds=2,
    consensus=False,
    sources=None,
):
    ctx = _context_block(
        question, personas, messages, mode, options or [], rounds,
        sources=sources,
        consensus=consensus,
    )
    solution = json.dumps(best_solution or {}, ensure_ascii=False)
    review = json.dumps(devil_review or {}, ensure_ascii=False)
    head = L(
        f'Рішення після дискусії (JSON): {solution}\n'
        f'Критика AI Devil (JSON): {review}\n\n',
        f'Solution after the discussion (JSON): {solution}\n'
        f'AI Devil’s criticism (JSON): {review}\n\n',
    )
    task = L(
        'Учасники вже відповіли на критику AI Devil (див. кінець історії). '
        'Зваж критику та їхні відповіді і виріши, чи витримує висновок перевірку. '
        'У decision та revision згадуй учасників за іменами, які дав користувач, '
        'якщо їхні аргументи вплинули на висновок. '
        'Якщо аргументи Devil незначні або учасники їх переконливо спростували — '
        'підтверди висновок (confirmed: true). '
        'Якщо Devil знайшов серйозні слабкі місця — перегляни висновок '
        '(confirmed: false, у decision — виправлений варіант, '
        'у revision — що саме змінилось). Поле confirmed обов’язкове. '
        'У dissenting_points збережи окремі думки учасників, які лишились '
        'непереконаними, — користувачу важливо їх бачити. '
        'confidence — твоя оцінка надійності висновку (0–100) з огляду на силу '
        'аргументів, якість фактів і рівень згоди учасників: 85+ — лише коли '
        'факти надійні й серйозних заперечень не лишилось; 50–70 — коли багато '
        'залежить від обставин, яких ви не знаєте. '
        'recommendation — конкретний перший крок, який людина може зробити '
        'найближчими днями, а не загальна порада. ',
        'The participants have already responded to AI Devil’s criticism (see the '
        'end of the history). Weigh the criticism and their responses and decide '
        'whether the conclusion holds up. '
        'In decision and revision mention participants by the names the user gave '
        'them if their arguments influenced the conclusion. '
        'If Devil’s arguments are minor or the participants convincingly refuted '
        'them, confirm the conclusion (confirmed: true). '
        'If Devil found serious weak spots, revise the conclusion '
        '(confirmed: false, the corrected version in decision, '
        'what exactly changed in revision). The confirmed field is required. '
        'In dissenting_points keep the separate opinions of participants who '
        'remained unconvinced — the user needs to see them. '
        'confidence — your estimate of how reliable the conclusion is (0–100) '
        'given the strength of the arguments, the quality of the facts and the '
        'level of agreement: 85+ only when the facts are reliable and no serious '
        'objections remain; 50–70 when a lot depends on circumstances you do not know. '
        'recommendation — a concrete first step the person can take in the next '
        'few days, not general advice. ',
    )
    schema = L(
        'Відповідай СУВОРО одним JSON-об’єктом:\n'
        f'{{{_answer_schema(mode, options)}"decision": "фінальне рішення", '
        '"confirmed": true або false, '
        '"revision": "що змінилось після Devil (порожнє, якщо підтверджено)", '
        '"pros": ["перевага"], "cons": ["недолік"], "risks": ["ризик"], '
        '"dissenting_points": ["окрема думка: хто і що"], '
        '"confidence": 0-100, "recommendation": "що робити далі"}',
        'Reply STRICTLY with a single JSON object:\n'
        f'{{{_answer_schema(mode, options)}"decision": "the final solution", '
        '"confirmed": true or false, '
        '"revision": "what changed after Devil (empty if confirmed)", '
        '"pros": ["advantage"], "cons": ["drawback"], "risks": ["risk"], '
        '"dissenting_points": ["separate opinion: who and what"], '
        '"confidence": 0-100, "recommendation": "what to do next"}',
    )
    return f'{ctx}\n\n{head}{task}{_rules(sources)}{_answer_rule(mode)}{schema}'
