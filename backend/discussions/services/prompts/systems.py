"""Системні промпти: учасник із його характером, судді й рядок статусу."""

import re

from backend.i18n import L

from ...personas import trait_guidance
from .rules_uk import (
    CHARACTER_DIRECTIVES,
    CHARACTER_LIMITS,
    DEVIL_SYSTEM,
    MODERATOR_SYSTEM,
    SAFETY_RULE,
    STATUS_SYSTEM,
    SYSTEM_BASE,
)
from .rules_en import (
    CHARACTER_DIRECTIVES_EN,
    CHARACTER_LIMITS_EN,
    DEVIL_SYSTEM_EN,
    MODERATOR_SYSTEM_EN,
    SAFETY_RULE_EN,
    STATUS_SYSTEM_EN,
    SYSTEM_BASE_EN,
)
from .common import _inline


def safety_rule():
    return L(SAFETY_RULE, SAFETY_RULE_EN)


def devil_system():
    return L(DEVIL_SYSTEM, DEVIL_SYSTEM_EN)


def moderator_system():
    return L(MODERATOR_SYSTEM, MODERATOR_SYSTEM_EN)


def status_system():
    return L(STATUS_SYSTEM, STATUS_SYSTEM_EN)


def status_prompt(question, stage, focus):
    lines = '\n'.join(f'- {item["name"]}: {item["text"]}' for item in focus)
    return L(
        f'<user_question>\n{_inline(question)[:600]}\n</user_question>\n\n'
        f'Етап: {stage or "обговорення"}.\n'
        f'Що зараз робить кожен AI:\n{lines}\n\n'
        'Напиши рядок статусу.',
        f'<user_question>\n{_inline(question)[:600]}\n</user_question>\n\n'
        f'Stage: {stage or "discussion"}.\n'
        f'What each AI is doing right now:\n{lines}\n\n'
        'Write the status line.',
    )


def _persona_block(persona):
    unset = L('не задано', 'not set')
    style = _inline(persona.get("style"), unset)
    style = re.sub(r'^(?:Ти — «[^»]+»|You are “[^”]+”)\.\s*', '', style)
    lines = [
        L('Ім’я: ', 'Name: ') + _inline(persona.get('name'), L('Учасник', 'Participant')),
        L('Темперамент: ', 'Temperament: ') + _inline(persona.get('temperament'), unset),
        L('Опис: ', 'Description: ') + _inline(persona.get('description'), unset),
        L('Базовий характер: ', 'Base character: ') + style,
    ]
    if persona.get('custom_style'):
        lines.append(
            L('Додатковий стиль від користувача: ', 'Additional style from the user: ')
            + _inline(persona['custom_style'])
        )
    traits = persona.get('traits') or []
    if traits:
        lines.append(L('Додаткові риси: ', 'Additional traits: ') + ', '.join(traits))
        lines.append(L('Як ці риси мають проявлятися:', 'How these traits should show:'))
        for trait in traits:
            lines.append(f'- {trait}: {trait_guidance(trait)}')
    else:
        lines.append(L('Додаткові риси: не вибрано', 'Additional traits: none selected'))
    return '\n'.join(lines)


def persona_system(persona):
    """Системний промпт, який тримає модель у характері протягом усієї дискусії."""
    return (
        f'{L(SYSTEM_BASE, SYSTEM_BASE_EN)}\n\n'
        f'{L("Твоя роль у цій дискусії:", "Your role in this discussion:")}\n'
        f'{_persona_block(persona)}\n\n'
        f'{L(CHARACTER_DIRECTIVES, CHARACTER_DIRECTIVES_EN)}\n\n'
        f'{L(CHARACTER_LIMITS, CHARACTER_LIMITS_EN)}'
    )
