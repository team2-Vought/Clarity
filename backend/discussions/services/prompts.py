"""Промпти для фаз дискусії."""

from .providers import DEBATE, DEVIL, FINAL, OPENING, SYNTHESIS

HISTORY_LIMIT = 24

SYSTEM_BASE = (
    'Ти береш участь у дискусії на платформі Clariti, де кілька AI-персон '
    'обговорюють проблему користувача, сперечаються та шукають найкраще рішення. '
    'Відповідай українською мовою, стисло та по суті (до 120 слів). '
    'Не використовуй markdown-списки, пиши звичайними реченнями.'
)

DEVIL_SYSTEM = (
    'Ти — AI Devil. Твоя єдина задача — знайти слабкі місця в запропонованому рішенні: '
    'ризики, помилки, приховані припущення, контраргументи. '
    'Будь прямим і невблаганним, але аргументованим. Відповідай українською.'
)

MODERATOR_SYSTEM = (
    'Ти — Модератор Clariti. Після дискусії AI-персон ти пропонуєш найкраще рішення '
    'і фінальний підсумок для користувача. Відповідай українською, чесно та зважено.'
)


def mode_block(mode, options):
    if mode == 'yes_no':
        return (
            'Режим дискусії: «Так або ні».\n'
            'Висновок дискусії має бути однозначним: ТАК або НІ.'
        )
    if mode == 'choose_one':
        variants = '; '.join(options)
        return (
            'Режим дискусії: «Один із варіантів».\n'
            f'Варіанти: {variants}\n'
            'Висновок має чітко обрати один із них.'
        )
    return 'Режим дискусії: «Вільна відповідь» (генеративний висновок).'


def _history_block(messages):
    lines = []
    for m in messages[-HISTORY_LIMIT:]:
        role = m.persona_name
        lines.append(f'{role}: {m.content}')
    return '\n'.join(lines) if lines else '(поки що без повідомлень)'


def opening_prompt(question, persona, mode='open', options=None):
    return (
        f'<<{OPENING}>>\n'
        f'<<persona:{persona["slug"]}>>\n'
        f'<<mode:{mode}>>\n'
        f'{mode_block(mode, options or [])}\n'
        f'Запитання: {question}\n'
        f'Твій характер: {persona["style"]}\n'
        f'Дай початкову думку щодо проблеми (1 абзац).'
    )


def debate_prompt(question, persona, messages, debate_round, mode='open', options=None):
    return (
        f'<<{DEBATE}>>\n'
        f'<<persona:{persona["slug"]}>>\n'
        f'<<mode:{mode}>>\n'
        f'{mode_block(mode, options or [])}\n'
        f'Запитання: {question}\n'
        f'Твій характер: {persona["style"]}\n'
        f'Раунд дискусії: {debate_round}\n'
        f'Хід дискусії:\n{_history_block(messages)}\n'
        f'Продовжи дискусію: відреагуй на інших, погоджуйся або сперечайся, '
        f'наведи аргумент або знайди слабке місце в чужій ідеї (1 абзац).'
    )


def synthesis_prompt(question, messages, mode='open', options=None):
    if mode == 'yes_no':
        answer_schema = '"answer": "так" або "ні", '
    elif mode == 'choose_one':
        answer_schema = f'"answer": "один із варіантів ({'; '.join(options or [])})", '
    else:
        answer_schema = ''
    return (
        f'<<{SYNTHESIS}>>\n'
        f'<<mode:{mode}>>\n'
        f'{mode_block(mode, options or [])}\n'
        f'Запитання: {question}\n'
        f'Хід дискусії:\n{_history_block(messages)}\n'
        f'На основі аргументів усіх учасників запропонуй найкращий варіант рішення. '
        f'Відповідай СУВОРО у форматі JSON без пояснень поза JSON:\n'
        f'{{{answer_schema}"decision": "суть рішення", "reasoning": "чому саме воно", '
        f'"supporting_arguments": ["аргумент"], "dissenting_points": ["непогоджена теза"]}}'
    )


def devil_prompt(question, best_solution, messages, mode='open', options=None):
    decision = best_solution.get('decision', '')
    reasoning = best_solution.get('reasoning', '')
    return (
        f'<<{DEVIL}>>\n'
        f'<<persona:devil>>\n'
        f'<<mode:{mode}>>\n'
        f'{mode_block(mode, options or [])}\n'
        f'Запитання: {question}\n'
        f'Запропоноване рішення: {decision}\n'
        f'Обґрунтування: {reasoning}\n'
        f'Контекст дискусії:\n{_history_block(messages)}\n'
        f'Спробуй довести, що це рішення неправильне або ризикове. '
        f'Відповідай СУВОРО у форматі JSON:\n'
        f'{{"verdict": "короткий вердикт", '
        f'"risks": [{{"title": "назва", "description": "опис", "severity": "низька|середня|висока"}}], '
        f'"weak_spots": ["слабке місце"], "counter_arguments": ["контраргумент"]}}'
    )


def final_prompt(question, best_solution, devil_review, messages, mode='open', options=None):
    decision = best_solution.get('decision', '')
    verdict = devil_review.get('verdict', '')
    if mode == 'yes_no':
        answer_schema = '"answer": "так" або "ні", '
    elif mode == 'choose_one':
        answer_schema = f'"answer": "один із варіантів ({'; '.join(options or [])})", '
    else:
        answer_schema = ''
    return (
        f'<<{FINAL}>>\n'
        f'<<mode:{mode}>>\n'
        f'{mode_block(mode, options or [])}\n'
        f'Запитання: {question}\n'
        f'Рішення після дискусії: {decision}\n'
        f'Вердикт AI Devil: {verdict}\n'
        f'Ризики Devil: {devil_review.get("risks", [])}\n'
        f'Хід дискусії:\n{_history_block(messages)}\n'
        f'Після критики AI Devil виріши: чи витримує висновок перевірку. '
        f'Якщо аргументи Devil незначні — підтверди висновок (confirmed: true). '
        f'Якщо Devil знайшов серйозні слабкі місця — перегляни висновок '
        f'(confirmed: false, у decision — виправлений варіант, у revision — що саме змінилось). '
        f'Відповідай СУВОРО у форматі JSON:\n'
        f'{{{answer_schema}"decision": "фінальне рішення", "confirmed": true або false, '
        f'"revision": "що змінилось після Devil (порожнє, якщо підтверджено)", '
        f'"pros": ["перевага"], "cons": ["недолік"], "risks": ["ризик"], '
        f'"confidence": 0-100, "recommendation": "що робити далі"}}'
    )
