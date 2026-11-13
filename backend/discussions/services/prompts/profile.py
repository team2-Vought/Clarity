"""Профіль «Про мене» в промптах: хто ця людина, щоб поради пасували саме їй."""

from backend.i18n import L

from accounts.about import label

from .common import _inline


def _lines(profile):
    """[(підпис, значення)] — лише заповнені поля, варіанти — словами мовою дискусії."""
    finances = label('finances', profile.get('finances'))
    note = _inline(profile.get('finances_note'))
    if note:
        finances = f'{finances}; {note}' if finances else note
    values = ', '.join(
        filter(None, (label('values', key) for key in profile.get('values') or []))
    )
    return [
        (L('Країна / місто', 'Country / city'), _inline(profile.get('location'))),
        (L('Вік', 'Age'), label('age', profile.get('age'))),
        (L('Сім’я', 'Family'), _inline(profile.get('family'))),
        (L('Чим займається', 'Occupation'), _inline(profile.get('occupation'))),
        (L('Фінанси', 'Finances'), finances),
        (L('Що найважливіше', 'What matters most'), values),
        (L('Ставлення до ризику', 'Attitude to risk'), label('risk', profile.get('risk'))),
        (L('Що ще варто знати', 'Anything else'), _inline(profile.get('notes'))),
    ]


OUTCOMES = {
    'good': ('вийшло добре', 'went well'),
    'mixed': ('вийшло по-різному', 'mixed results'),
    'bad': ('вийшло погано', 'went badly'),
}


def history_block(profile):
    """Як вийшли минулі рішення людини з журналу; '' — підсумованих рішень немає."""
    history = (profile or {}).get('history')
    lines = []
    for item in history if isinstance(history, list) else []:
        if not isinstance(item, dict) or not _inline(item.get('decision')):
            continue
        outcome = OUTCOMES.get(item.get('outcome'))
        line = L(
            f'- Питання: {_inline(item.get("question"))}. Рішення: {_inline(item.get("decision"))}.',
            f'- Question: {_inline(item.get("question"))}. Decision: {_inline(item.get("decision"))}.',
        )
        if outcome:
            line += ' ' + L(f'Результат: {outcome[0]}.', f'Outcome: {outcome[1]}.')
        if _inline(item.get('reflection')):
            line += ' ' + L(
                f'Що людина зрозуміла: {_inline(item.get("reflection"))}',
                f'What the person learned: {_inline(item.get("reflection"))}',
            )
        lines.append(line)
    if not lines:
        return ''
    return '\n'.join(
        [
            L(
                'Минулі рішення людини з її журналу і як вони вийшли:',
                'The person’s past decisions from their journal and how they turned out:',
            ),
            '<user_history>',
            *lines,
            '</user_history>',
            L(
                'Якщо щось із цього стосується нинішнього питання — врахуй: що людині вже '
                'спрацювало, на чому вона обпеклася, які уроки сама сформулювала. Згадуй '
                'минуле рішення, лише коли воно справді доречне, й коротко.',
                'If any of this is relevant to the current question, take it into account: '
                'what has worked for the person, where they got burned, what lessons they '
                'drew themselves. Mention a past decision only when it is truly relevant, '
                'and briefly.',
            ),
        ]
    )


def profile_block(profile):
    """Блок <user_profile> з правилом, як його враховувати, і минулі рішення;
    '' — ні профілю, ні історії немає."""
    history = history_block(profile)
    lines = [f'{title}: {value}' for title, value in _lines(profile or {}) if value]
    if not lines:
        return history
    about = '\n'.join(
        [
            L(
                'Профіль людини — вона заповнила його сама, щоб поради були персональними:',
                'The person’s profile — they filled it in themselves so the advice is personal:',
            ),
            '<user_profile>',
            *lines,
            '</user_profile>',
            L(
                'Враховуй профіль: порада має пасувати віку, сім’ї, фінансам, цінностям і '
                'ставленню до ризику саме цієї людини. Якщо запитання чи уточнення '
                'суперечать профілю, вір їм — вони свіжіші. Не переказуй профіль і не '
                'згадуй його без потреби: просто радь як тому, хто знає людину.',
                'Take the profile into account: the advice must fit this person’s age, '
                'family, finances, values and attitude to risk. If the question or the '
                'clarifications contradict the profile, trust them — they are newer. Do not '
                'retell the profile or mention it needlessly: just advise like someone who '
                'knows the person.',
            ),
        ]
    )
    return f'{about}\n\n{history}' if history else about
