"""Промпти учасників: вступ, репліка в дебатах, відповідь на AI Devil."""

from backend.i18n import L

from .context import (
    _context_block,
    _reply_block,
    _speaker_line,
    _user_notes_block,
    length_rule,
    service_lines_block,
)


def opening_prompt(
    question,
    persona,
    personas,
    mode='open',
    options=None,
    rounds=2,
    consensus=False,
    sources=None,
    profile=None,
    documents=None,
    can_search=False,
):
    """Вступ генерується паралельно: учасник не бачить позицій інших."""
    ctx = _context_block(
        question, personas, None, mode, options or [], rounds,
        sources=sources,
        profile=profile,
        documents=documents,
        consensus=consensus,
    )
    task = L(
        'Це вступне слово. Інші учасники формулюють свої позиції одночасно '
        'з тобою, тож ти ще не знаєш їхніх думок — сформуй власну незалежну '
        'позицію через призму свого характеру. Не намагайся охопити все: обери '
        'кут, який найкраще видно саме тобі, і доведи його. Орієнтовна структура:\n'
        '1. Перше речення — твоя чітка позиція, її суть виділи **жирним**.\n'
        '2. 2–3 найсильніші аргументи з конкретикою — абзацами або списком.\n'
        '3. Головне питання чи ризик, який варто перевірити в дискусії.',
        'This is your opening statement. The other participants are forming '
        'their positions at the same time as you, so you do not know their views '
        'yet — form your own independent position through the lens of your '
        'character. Do not try to cover everything: pick the angle you see best '
        'and make the case for it. Suggested structure:\n'
        '1. The first sentence is your clear position; put its essence in **bold**.\n'
        '2. The 2–3 strongest arguments with specifics — as paragraphs or a list.\n'
        '3. The main question or risk worth testing in the discussion.',
    )
    return (
        f'{ctx}\n\n'
        f'{_speaker_line(persona)}\n\n'
        f'{task}\n\n'
        f'{length_rule("opening")}\n\n'
        f'{service_lines_block(mode, options, "opening", can_search)}'
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
    consensus=False,
    reply_to=None,
    reply_reason='',
    sources=None,
    profile=None,
    documents=None,
    can_search=False,
    user_notes=None,
):
    ctx = _context_block(
        question,
        personas,
        messages,
        mode,
        options or [],
        rounds,
        debate_round,
        full_tail=len(personas),
        sources=sources,
        profile=profile,
        documents=documents,
        consensus=consensus,
    )
    reply_block = _reply_block(reply_to, reply_reason) or L(
        'Обери одну конкретну тезу іншого учасника, звернись до нього або до '
        'неї на ім’я і відреагуй саме на неї.',
        'Pick one specific point made by another participant, address them by '
        'name and respond to exactly that point.',
    )
    notes = _user_notes_block(user_notes)
    goal = (
        L(
            'Мета цієї дискусії — дійти спільного висновку всіма учасниками: шукай, '
            'на чому можна зійтися, і прямо називай умови, за яких ти погодишся. '
            'Але не поступайся без переконливих аргументів — згода має бути чесною.',
            'The goal of this discussion is for all participants to reach a shared '
            'conclusion: look for common ground and name the conditions under which '
            'you would agree. But do not give in without convincing arguments — the '
            'agreement must be honest.',
        )
        if consensus
        else ''
    )
    if debate_round >= rounds:
        closing = L(
            'Це останній раунд: не відкривай нових тем. Чітко сформулюй, на чому '
            'ти зрештою стоїш, чесно визнай найсильніший аргумент опонентів і '
            'поясни, чи змінив він твою думку.',
            'This is the last round: do not open new topics. State clearly where '
            'you ultimately stand, honestly acknowledge your opponents’ strongest '
            'argument and explain whether it changed your mind.',
        )
    else:
        closing = L(
            'Наприкінці постав цьому учаснику одне конкретне запитання, '
            'на яке він або вона має відповісти.',
            'At the end ask this participant one specific question they have to answer.',
        )
    parts = [ctx, _speaker_line(persona)]
    if notes:
        parts.append(notes)
    if goal:
        parts.append(goal)
    parts.extend(
        [
            reply_block,
            L(
                'Продовжи дискусію: не переказуй загальні міркування, '
                'а вступи у прямий діалог — наведи новий аргумент або знайди слабке '
                'місце в чужій ідеї. Не повторюй уже сказане ні собою, ні іншими. '
                'Якщо тебе переконали — так і скажи, це нормально. Якщо ви вже згодні '
                'в головному, не повторюй згоди: переходь до наступного невирішеного '
                'питання або уточни, за яких умов рішення спрацює. '
                f'{closing} Запитання винеси в окремий останній абзац — '
                'по суті рішення, а не про особу співрозмовника.',
                'Continue the discussion: do not restate general considerations, '
                'engage in direct dialogue — bring a new argument or find a weak spot '
                'in someone else’s idea. Do not repeat what you or others have already '
                'said. If you have been convinced, say so — that is fine. If you '
                'already agree on the main point, do not repeat the agreement: move '
                'on to the next unresolved question or clarify under what conditions '
                f'the solution will work. {closing} Put the question in a separate '
                'final paragraph — about the substance of the decision, not about '
                'the other participant.',
            ),
            length_rule('debate'),
            service_lines_block(mode, options, 'debate', can_search),
        ]
    )
    return '\n\n'.join(parts)


def rebuttal_prompt(
    question,
    persona,
    personas,
    messages,
    mode='open',
    options=None,
    rounds=2,
    consensus=False,
    sources=None,
    profile=None,
    documents=None,
    user_notes=None,
):
    ctx = _context_block(
        question,
        personas,
        messages,
        mode,
        options or [],
        rounds,
        full_tail=len(personas),
        sources=sources,
        profile=profile,
        documents=documents,
        consensus=consensus,
    )
    parts = [ctx, _speaker_line(persona)]
    notes = _user_notes_block(user_notes)
    if notes:
        parts.append(notes)
    parts.extend(
        [
            L(
                'Модератор запропонував рішення, а AI Devil його розкритикував '
                '(останні повідомлення в історії). Коротко відреагуй на критику AI Devil: '
                'які закиди справедливі, які ні і чому, '
                'і чи змінює це твою позицію. Якщо закид справедливий — запропонуй, '
                'як змінити рішення, щоб його врахувати. Звертайся до AI Devil напряму. '
                'Не повторюй своїх попередніх реплік.',
                'The moderator proposed a solution and AI Devil criticised it '
                '(the latest messages in the history). Briefly respond to AI Devil’s '
                'criticism: which objections are fair, which are not and why, and '
                'whether this changes your position. If an objection is fair, suggest '
                'how to change the solution to account for it. Address AI Devil '
                'directly. Do not repeat your earlier replies.',
            ),
            length_rule('rebuttal'),
            service_lines_block(mode, options, 'rebuttal'),
        ]
    )
    return '\n\n'.join(parts)
