"""Контекст дискусії для промптів: учасники, історія з уточненнями, джерела,
правила реплік (довжина, службові рядки, кому відповідати).
"""

import re

from django.conf import settings

from backend.i18n import L

from .common import (
    ROLE_LABELS,
    ROLE_LABELS_EN,
    _inline,
    _today_line,
    fallback_thesis,
    mode_block,
    stance_label,
)


def _stance_rule(mode, options, phase='debate'):
    """Правило службового рядка ПОЗИЦІЯ або '' — якщо позиція у фазі не потрібна."""
    if mode == 'yes_no':
        return L(
            'ПОЗИЦІЯ: так або ні — твоя відповідь на запитання зараз',
            'STANCE: yes or no — your answer to the question right now',
        )
    if mode == 'choose_one':
        variants = '; '.join(options or [])
        return L(
            'ПОЗИЦІЯ: дослівно один із варіантів, який ти зараз підтримуєш '
            f'({variants})',
            'STANCE: exactly one of the options you currently support, word for word '
            f'({variants})',
        )
    if phase == 'opening':
        # у вступі ще немає з чим погоджуватися
        return ''
    if phase == 'rebuttal':
        return L(
            'ПОЗИЦІЯ: «згода» — якщо ти підтримуєш рішення модератора з урахуванням '
            'критики AI Devil; «суперечка» — якщо ні',
            'STANCE: “agree” — if you support the moderator’s solution in light of '
            'AI Devil’s criticism; “dispute” — if not',
        )
    return L(
        'ПОЗИЦІЯ: «згода» — якщо ти поділяєш позицію співрозмовника, якому '
        'відповідаєш, і в тебе не лишилось суттєвих заперечень; '
        '«суперечка» — якщо заперечення лишаються',
        'STANCE: “agree” — if you share the position of the participant you are '
        'replying to and have no significant objections left; '
        '“dispute” — if objections remain',
    )


# Скільки слів основного тексту в кожній фазі. Ліміт стоїть у кінці завдання,
# а не лише в системному промпті: там моделі його помітно частіше ігнорують.
# Жорсткого max_tokens немає — він обрізав би текст і службові рядки в кінці.
REPLY_LENGTH = {
    'opening': (160, '3–5'),
    'debate': (180, '3–5'),
    'rebuttal': (100, '2–3'),
}


def length_rule(phase):
    words, blocks = REPLY_LENGTH[phase]
    return L(
        f'Обсяг основного тексту — до {words} слів ({blocks} коротких абзаців '
        'чи пунктів). Довша репліка не краща: залиш лише найсильніше.',
        f'Length of the main text — up to {words} words ({blocks} short paragraphs '
        'or points). A longer reply is not better: keep only the strongest.',
    )


def service_lines_block(mode, options, phase='debate', can_search=False):
    """Службові рядки: теза для історії, позиція для консенсусу, запит для пошуку."""
    lines = [L(
        'ТЕЗА: одне речення до 25 слів — головна думка цієї репліки',
        'THESIS: one sentence of up to 25 words — the main point of this reply',
    )]
    stance = _stance_rule(mode, options, phase)
    if stance:
        lines.append(stance)
    block = L(
        f'Після основного тексту додай службові рядки ({len(lines)}), кожен з нового '
        'рядка (користувач їх не побачить, вони потрібні для протоколу дискусії):\n',
        f'After the main text add service lines ({len(lines)}), each on a new line '
        '(the user will not see them, they are needed for the discussion log):\n',
    ) + '\n'.join(lines)
    if can_search:
        block += L(
            '\nПошук в інтернеті — за потреби, а не обов’язково. Лише якщо для '
            'аргументу справді бракує фактів (ціни, статистика, правила, свіжі '
            'новини), яких немає в описі користувача та вже знайдених джерелах, '
            'додай ще один рядок «ПОШУК: короткий пошуковий запит». Система '
            'знайде джерела, і вони стануть доступні всім учасникам у наступних '
            'репліках. Для особистих питань, де вирішують цінності й обставини '
            'користувача, а не зовнішні факти, цей рядок зазвичай не потрібен.',
            '\nWeb search — when needed, not mandatory. Only if your argument '
            'really lacks facts (prices, statistics, rules, recent news) that are '
            'not in the user’s description or the sources already found, add one '
            'more line “SEARCH: a short search query”. The system will find '
            'sources, and they will be available to all participants in the next '
            'replies. For personal questions, where the user’s values and '
            'circumstances decide rather than external facts, this line is '
            'usually not needed.',
        )
    return block


def _reply_block(reply_to, reason=''):
    if not reply_to:
        return ''
    if reason == 'user':
        return L(
            f'Користувач «{reply_to}» написав уточнення (див. блок вище). '
            'Почни з прямої відповіді на нього, звернувшись на ім’я, і поясни, '
            'як це уточнення змінює твою позицію.',
            f'The user “{reply_to}” wrote a clarification (see the block above). '
            'Start with a direct answer to it, addressing them by name, and explain '
            'how this clarification changes your position.',
        )
    if reason == 'question':
        lead = L(
            f'Учасник «{reply_to}» звернувся до тебе з запитанням або закидом. '
            'Почни з прямої відповіді саме на нього, звернувшись на ім’я.',
            f'The participant “{reply_to}” addressed you with a question or an '
            'objection. Start with a direct answer to exactly that, addressing them by name.',
        )
    elif reason == 'disagree':
        lead = L(
            f'Ти відповідаєш учаснику «{reply_to}», з яким у тебе різні позиції. '
            'У першому реченні звернись до нього або до неї на ім’я і '
            'покажи, де саме ви розходитесь.',
            f'You are replying to the participant “{reply_to}”, whose position '
            'differs from yours. In the first sentence address them by name and '
            'show exactly where you disagree.',
        )
    else:
        lead = L(
            f'Ти відповідаєш учаснику «{reply_to}». '
            'У першому реченні звернись до цього учасника на ім’я.',
            f'You are replying to the participant “{reply_to}”. '
            'In the first sentence address this participant by name.',
        )
    return lead + L(
        ' Коротко перекажи його або її тезу (до 10 слів), '
        'погодься чи запереч і поясни чому. Не звертайся до всіх одразу.',
        ' Briefly restate their point (up to 10 words), agree or object and '
        'explain why. Do not address everyone at once.',
    )


def _participants_block(personas):
    lines = []
    for persona in personas:
        traits = persona.get('traits') or []
        traits_text = (
            L('; риси: ', '; traits: ') + ', '.join(_inline(trait) for trait in traits)
            if traits
            else ''
        )
        name = _inline(persona.get('name'), L('Учасник', 'Participant'))
        temperament = _inline(persona.get('temperament'), L('без темпераменту', 'no temperament'))
        lines.append(
            f'- <user_name>{name}</user_name> — '
            f'{temperament}. '
            f'{_inline(persona.get("description"))}{traits_text}'
        )
    return '\n'.join(lines)


def _line_prefix(message):
    round_prefix = L(f'[Раунд {message.round}] ', f'[Round {message.round}] ') if message.round else ''
    if getattr(message, 'phase', '') == 'rebuttal':
        round_prefix = L('[Відповідь на AI Devil] ', '[Reply to AI Devil] ')
    role = L(ROLE_LABELS, ROLE_LABELS_EN).get(message.role, message.role)
    reply_to = _inline(getattr(message, 'reply_to', ''))
    reply_prefix = L(f' → відповідає {reply_to}', f' → replying to {reply_to}') if reply_to else ''
    stance = stance_label(_inline(getattr(message, 'stance', '')))
    stance_suffix = L(f' [позиція: {stance}]', f' [stance: {stance}]') if stance else ''
    return (
        f'{round_prefix}{_inline(message.persona_name)}{reply_prefix} '
        f'({role}){stance_suffix}'
    )


def _message_line(message):
    return f'{_line_prefix(message)}: {message.content}'


def _compact_line(message):
    thesis = _inline(getattr(message, 'thesis', '')) or fallback_thesis(message.content)
    return f'{_line_prefix(message)} — {L("коротко", "in short")}: {thesis}'


def _without_question(messages):
    """Перше повідомлення користувача — саме запитання, воно вже є в <user_question>."""
    first_user = next((m for m in messages if m.role == 'user'), None)
    return [m for m in messages if m is not first_user]


def _render_lines(messages, full_tail):
    """Повертає [(message, line)].

    Репліки AI-учасників, старші за останні `full_tail`, стискаються до тези:
    повний текст давніх раундів моделі майже не потрібен, а промпт без нього
    у рази коротший. Повідомлення користувача, модератора й Devil завжди повні.
    """
    if full_tail is None:
        return [(message, _message_line(message)) for message in messages]
    ai_indexes = [i for i, message in enumerate(messages) if message.role == 'ai']
    compact = set(ai_indexes[: max(0, len(ai_indexes) - full_tail)])
    return [
        (message, _compact_line(message) if i in compact else _message_line(message))
        for i, message in enumerate(messages)
    ]


def _size(rendered):
    return sum(len(line) + 1 for _, line in rendered)


def _history_messages(messages, full_tail=None):
    """Повертає (рядки, чи довелося відкидати повідомлення).

    Якщо історія не влазить у ліміт, давні репліки спершу стискаються до тез
    (так модератор не втрачає вступних позицій), і лише потім найстаріші
    відкидаються. Уточнення користувача не відкидаються ніколи.
    """
    limit = max(500, int(getattr(settings, 'LLM_HISTORY_MAX_CHARS', 24000)))
    messages = _without_question(list(messages or []))
    rendered = _render_lines(messages, full_tail)
    if not rendered:
        return [], False
    if _size(rendered) <= limit:
        return [line for _, line in rendered], False

    ai_count = sum(1 for message in messages if message.role == 'ai')
    tail = ai_count if full_tail is None else full_tail
    while tail > 0:
        tail //= 2
        rendered = _render_lines(messages, tail)
        if _size(rendered) <= limit:
            return [line for _, line in rendered], False

    pinned = {id(message) for message, _ in rendered if message.role == 'user'}
    used = sum(len(line) + 1 for message, line in rendered if id(message) in pinned)
    keep = set(pinned)
    for message, line in reversed(rendered):
        if id(message) in keep:
            continue
        if used + len(line) + 1 > limit and len(keep) > len(pinned):
            break
        keep.add(id(message))
        used += len(line) + 1
    return [line for message, line in rendered if id(message) in keep], True


def _history_block(messages, full_tail=None):
    selected, trimmed = _history_messages(messages, full_tail)
    lines = []
    if trimmed:
        lines.append(L(
            '[Частину давніших повідомлень скорочено, щоб не перевищити контекст.]',
            '[Some older messages were shortened to stay within the context.]',
        ))
    lines.extend(selected)
    return '\n'.join(lines) if lines else L('(поки що без повідомлень)', '(no messages yet)')


SOURCE_SNIPPET_LIMIT = 350


def _domain(url):
    match = re.match(r'https?://([^/]+)', str(url or ''))
    return match.group(1).removeprefix('www.') if match else ''


def sources_block(sources):
    limit = max(1, int(getattr(settings, 'SEARCH_MAX_SOURCES_IN_PROMPT', 16)))
    items = list(sources or [])[-limit:]
    if not items:
        return ''
    lines = []
    for source in items:
        snippet = _inline(source.get('snippet'))
        if len(snippet) > SOURCE_SNIPPET_LIMIT:
            snippet = snippet[: SOURCE_SNIPPET_LIMIT - 1].rstrip() + '…'
        lines.append(
            f'[{source.get("id")}] {_inline(source.get("title"))} '
            f'({_domain(source.get("url"))}): {snippet}'
        )
    return (
        L(
            'Знайдені в інтернеті джерела (можуть бути неповними чи застарілими — '
            'оцінюй їх критично):\n<web_sources>\n',
            'Sources found on the web (they may be incomplete or outdated — '
            'assess them critically):\n<web_sources>\n',
        )
        + '\n'.join(lines)
        + '\n</web_sources>'
    )


def _context_block(
    question,
    personas,
    messages,
    mode,
    options,
    rounds,
    current_round=None,
    full_tail=None,
    sources=None,
    consensus=False,
):
    lines = [
        L('Опис проблеми / запитання користувача:', 'Problem description / the user’s question:'),
        '<user_question>',
        question,
        '</user_question>',
    ]
    lines.extend(
        [
            '',
            _today_line(),
            mode_block(mode, options or []),
            (
                L(
                    'Дискусія триває, доки всі учасники не дійдуть одного висновку '
                    f'(не більше {rounds} раундів).',
                    'The discussion continues until all participants reach the same '
                    f'conclusion (no more than {rounds} rounds).',
                )
                if consensus
                else L(f'Заплановано раундів дискусії: {rounds}', f'Planned discussion rounds: {rounds}')
            ),
        ]
    )
    if current_round is not None:
        lines.append(L(
            f'Поточний раунд: {current_round} з {rounds}',
            f'Current round: {current_round} of {rounds}',
        ))
    lines.extend(['', L('Учасники дискусії:', 'Discussion participants:'), _participants_block(personas)])
    block = sources_block(sources)
    if block:
        lines.extend(['', block])
    if messages is not None:
        lines.extend(
            [
                '',
                L(
                    'Історія дискусії (давні репліки учасників подано стисло):',
                    'Discussion history (older participant replies are condensed):',
                )
                if full_tail is not None
                else L('Історія дискусії:', 'Discussion history:'),
                '<debate_history>',
                _history_block(messages, full_tail),
                '</debate_history>',
            ]
        )
    return '\n'.join(lines)


def _speaker_line(persona):
    name = _inline(persona.get('name'), L('Учасник', 'Participant'))
    return L(
        f'Ти — {name}. Говори у своєму характері.',
        f'You are {name}. Speak in character.',
    )


def _user_notes_block(notes):
    if not notes:
        return ''
    lines = [
        L(f'- {_inline(note.persona_name)}: «{_inline(note.content)}»',
          f'- {_inline(note.persona_name)}: “{_inline(note.content)}”')
        for note in notes
    ]
    return (
        L(
            'Нові уточнення користувача, на які ти ще не реагував(-ла):\n',
            'New clarifications from the user that you have not reacted to yet:\n',
        )
        + '\n'.join(lines)
        + L('\nОбов’язково врахуй їх у цій репліці.', '\nBe sure to take them into account in this reply.')
    )
