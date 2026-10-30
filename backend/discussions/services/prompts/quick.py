"""Швидкий режим: одна коротка відповідь замість дебатів — для простих питань."""

from backend.i18n import L

from .common import _today_line, mode_block
from .context import _history_block
from .documents import documents_block
from .judges import _answer_schema
from .profile import profile_block


def quick_prompt(question, mode='open', options=None, profile=None, documents=None, messages=None):
    """Порада досвідченої людини за хвилину: суть, кілька кроків, чесна впевненість.

    `messages` — попередня розмова (для уточнень після швидкої відповіді)."""
    parts = [
        L('Запитання користувача:', 'The user’s question:'),
        f'<user_question>\n{question}\n</user_question>',
    ]
    for block in (profile_block(profile), documents_block(documents)):
        if block:
            parts.append(block)
    parts.extend([_today_line(), mode_block(mode, options or [])])
    if messages:
        parts.append(
            L('Попередня розмова:', 'The conversation so far:')
            + f'\n<debate_history>\n{_history_block(messages)}\n</debate_history>\n'
            + L(
                'Останнє повідомлення користувача — нове питання: відповідай саме на нього.',
                'The user’s last message is a new question: answer exactly that.',
            )
        )
    parts.append(L(
        'Дай швидку відповідь — так, ніби досвідчений і чесний порадник відповідає за '
        'хвилину. decision — 2–4 речення: що робити й чому, саме для ситуації цієї '
        'людини, без загальників. next_steps — 1–3 конкретні дії, кожна з дієслова. '
        'change_triggers — до 2 сигналів, коли варто передумати (можна порожньо). '
        'confidence — 0–100, нижче, якщо бракує даних. Якщо питання насправді '
        'складне й неоднозначне, одним реченням у decision порадь розібрати його '
        'детально. topic — тема для застережень: "crisis" — людина думає про '
        'самогубство чи самоушкодження або в гострій кризі; "medical" — здоров’я, '
        'лікування; "legal" — закон, договори, суди; "financial" — великі гроші: '
        'інвестиції, кредити, іпотека, борги; інакше "none".',
        'Give a quick answer — as if an experienced and honest advisor answered in a '
        'minute. decision — 2–4 sentences: what to do and why, for this person’s '
        'particular situation, no generalities. next_steps — 1–3 concrete actions, '
        'each starting with a verb. change_triggers — up to 2 signals to reconsider '
        '(may be empty). confidence — 0–100, lower if data is missing. If the question '
        'is actually complex and ambiguous, suggest in one sentence of decision to '
        'discuss it in detail. topic — the topic for disclaimers: "crisis" — the person '
        'is thinking about suicide or self-harm or is in acute crisis; "medical" — '
        'health, treatment; "legal" — law, contracts, courts; "financial" — big money: '
        'investments, loans, mortgages, debts; otherwise "none".',
    ))
    parts.append(L(
        'Відповідай СУВОРО одним JSON-об’єктом:\n'
        f'{{{_answer_schema(mode, options)}"decision": "що робити й чому", '
        '"next_steps": ["дія"], "change_triggers": ["якщо…"], '
        '"confidence": 0-100, "topic": "none"}',
        'Reply STRICTLY with a single JSON object:\n'
        f'{{{_answer_schema(mode, options)}"decision": "what to do and why", '
        '"next_steps": ["action"], "change_triggers": ["if…"], '
        '"confidence": 0-100, "topic": "none"}',
    ))
    return '\n\n'.join(parts)
