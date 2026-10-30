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
_CRISIS_RE = re.compile(
    r'(самогубств|суїцид|суицид|покінч\w* (з|із) собою|покінчити з життям|'
    r'покончить с собой|наклас\w* на себе руки|руки на себе наклас|'
    r'не хочу (більше )?жити|не хочу (больше )?жить|хочу померти|хочу умереть|'
    r'вбити себе|вбю себе|убить себя|убью себя|'
    r'самоушкодж|самоповрежд|різати себе|ріжу себе|порізати себе|резать себя|'
    r'\bsuicid|kill myself|end my life|take my (own )?life|want to die|'
    r'self[- ]?harm|hurt myself|cut myself)',
    re.IGNORECASE,
)


def looks_like_crisis(text):
    """Питання прямо говорить про самогубство чи самоушкодження."""
    return bool(_CRISIS_RE.search(text or ''))


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
