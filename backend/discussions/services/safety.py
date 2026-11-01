"""Чутливі теми: криза, здоров'я, право, великі гроші.

Криза (думки про самогубство чи самоушкодження) — не тема для дебатів AI:
дискусія не запускається, модератор відповідає людяно й коротко, а інтерфейс
показує контакти допомоги. Розпізнається двічі: одразу за словами в питанні
(без моделі, тож навіть без ключів) і моделлю модератора під час перевірки
контексту — вона ловить те, що не вкладається в слова.

Для здоров'я, права й великих грошей дискусія йде як завжди, а інтерфейс
показує застереження, що це не заміна фахівця.
"""

import re

from backend.i18n import L

CRISIS = 'crisis'
TOPICS = ('crisis', 'medical', 'legal', 'financial')

# Слова й фрази, за якими питання точно кризове (українська, російська, англійська).
# Навмисно вузько: краще пропустити до моделі, ніж зупинити звичайне питання про «ризик».
# «Не хочу жити» чи «hurt myself» — криза, лише коли фраза завершує речення:
# «не хочу жити з батьками» чи «hurt myself financially» — звичайні питання.
_END = r'(?=[ \t]*(?:[.!?…,;:)\n]|$))'
_CRISIS_RE = re.compile(
    r'(самогубств|суїцид|суицид|покінч\w* (з|із) собою|покінчити з життям|'
    r'покончить с собой|наклас\w* на себе руки|руки на себе наклас|'
    r'не хочу (більше |вже |далі )?жити' + _END + r'|'
    r'не хочу (больше |уже )?жить' + _END + r'|'
    r'хочу померти|хочу умереть|'
    r'вбити себе|вбю себе|убить себя|убью себя|'
    r'самоушкодж|самоповрежд|різати себе|ріжу себе|порізати себе|резать себя|'
    r'\bsuicid|kill myself|end my life|take my (own )?life(?! savings)|'
    r'want to die(?! (my|his|her|their|the|it)\b)|'
    r'self[- ]?harm|hurt myself' + _END + r'|cut myself' + _END + r')',
    re.IGNORECASE,
)

# Згадки про запобігання самогубствам — не криза, а тема (стартап, волонтерство, дослідження).
# Їх прибираємо з тексту до перевірки.
_NEUTRAL_RE = re.compile(
    r'(\bsuicid\w*[- ](prevention|hotline|helpline|awareness|squad|rates?)\b|'
    r'(профілактик|запобіганн|попередженн|профилактик|предотвращени|превенці)\w* '
    r'(самогубств|суїцид|суицид)\w*)',
    re.IGNORECASE,
)


def looks_like_crisis(text):
    """Питання прямо говорить про самогубство чи самоушкодження."""
    return bool(_CRISIS_RE.search(_NEUTRAL_RE.sub(' ', text or '')))


# Ширше: «не хочу жити» будь-де в реченні. Лише запасний варіант, коли модератор
# не відповів і кризу нікому розпізнати: тоді краще зайвий раз показати допомогу
# (людина натисне «Я питаю про інше»), ніж пропустити «не хочу жити і не бачу сенсу».
_POSSIBLE_CRISIS_RE = re.compile(
    r'(не хочу (більше |вже |далі )?жити|не хочу (больше |уже )?жить|'
    r'want to die|hurt myself|cut myself|не бачу сенсу жити|не вижу смысла жить|'
    r'no reason to live)',
    re.IGNORECASE,
)


def looks_like_possible_crisis(text):
    """Вузька ознака кризи або ширша — для випадку, коли модель не перевірила питання."""
    text = _NEUTRAL_RE.sub(' ', text or '')
    return bool(_CRISIS_RE.search(text) or _POSSIBLE_CRISIS_RE.search(text))


def normalize_topic(value):
    value = str(value or '').strip().lower()
    return value if value in TOPICS else ''


def crisis_message():
    """Що каже модератор замість дискусії; контакти допомоги показує інтерфейс."""
    return L(
        'Мені дуже шкода, що вам зараз так важко. Це питання не для суперечки AI — '
        'ви заслуговуєте на підтримку живої людини, і просто зараз.\n\n'
        'Зателефонуйте на лінію допомоги нижче: там вислухають, без осуду й '
        'безкоштовно. Якщо є загроза життю — дзвоніть **112** або **103**.\n\n'
        'Якщо можете, напишіть комусь, кому довіряєте, і скажіть, що вам погано. '
        'Ви не мусите проходити через це сам або сама.',
        'I am really sorry you are going through this. This is not a question for an '
        'AI debate — you deserve support from a real person, and right now.\n\n'
        'Please call one of the helplines below: they will listen without judgement, '
        'and it is free. If your life is in danger, call your local emergency number.\n\n'
        'If you can, message someone you trust and tell them you are not okay. '
        'You do not have to go through this alone.',
    )
