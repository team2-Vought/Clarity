"""Профіль «Про мене»: що людина розповіла про себе, щоб поради були персональними.

Поля необов'язкові. Варіанти зберігаються ключами (`25_34`, `cautious`), а
текстом стають лише в промптах — мовою дискусії. Вільний текст — як ввела
людина. `enabled` — чи враховувати профіль у нових дискусіях за замовчуванням.
"""

from rest_framework import serializers

from backend.i18n import L, lazy_L

TEXT_LIMITS = {
    'location': 80,
    'occupation': 120,
    'family': 200,
    'finances_note': 200,
    'notes': 500,
}

AGE_LABELS = {
    'under_18': ('до 18 років', 'under 18'),
    '18_24': ('18–24 роки', '18–24 years old'),
    '25_34': ('25–34 роки', '25–34 years old'),
    '35_44': ('35–44 роки', '35–44 years old'),
    '45_54': ('45–54 роки', '45–54 years old'),
    '55_64': ('55–64 роки', '55–64 years old'),
    '65_plus': ('65 років і більше', '65 or older'),
}

FINANCES_LABELS = {
    'tight': ('скрутно — кожна витрата відчутна', 'tight — every expense is felt'),
    'enough': (
        'вистачає на основне, заощаджень мало',
        'enough for the basics, few savings',
    ),
    'savings': ('є заощадження, подушка безпеки', 'has savings, a safety cushion'),
    'comfortable': ('фінансово вільно', 'financially comfortable'),
}

RISK_LABELS = {
    'cautious': (
        'обережне — уникає ризику, цінує запас міцності',
        'cautious — avoids risk, values a safety margin',
    ),
    'balanced': (
        'помірне — ризикує, якщо є план Б',
        'balanced — takes risks when there is a plan B',
    ),
    'bold': (
        'сміливе — готовий ризикувати заради більшого',
        'bold — ready to take risks for a bigger gain',
    ),
}

VALUE_LABELS = {
    'stability': ('стабільність', 'stability'),
    'freedom': ('свобода', 'freedom'),
    'family': ('сім’я', 'family'),
    'career': ('кар’єра', 'career'),
    'money': ('гроші', 'money'),
    'health': ('здоров’я', 'health'),
    'growth': ('розвиток', 'growth'),
    'creativity': ('творчість', 'creativity'),
    'calm': ('спокій', 'peace of mind'),
    'adventure': ('нові враження', 'new experiences'),
}
VALUES_MAX = 5

CHOICES = {'age': AGE_LABELS, 'finances': FINANCES_LABELS, 'risk': RISK_LABELS}

EMPTY = {
    'enabled': True,
    'location': '',
    'age': '',
    'family': '',
    'occupation': '',
    'finances': '',
    'finances_note': '',
    'values': [],
    'risk': '',
    'notes': '',
}

UNKNOWN_CHOICE = lazy_L('Невідомий варіант', 'Unknown option')
TOO_MANY_VALUES = lazy_L(
    f'Оберіть не більше {VALUES_MAX} цінностей',
    f'Choose no more than {VALUES_MAX} values',
)


def about_of(user):
    """Збережений профіль поверх порожнього (без зайвих чи пошкоджених ключів)."""
    stored = user.about if isinstance(user.about, dict) else {}
    about = {key: stored.get(key, default) for key, default in EMPTY.items()}
    if not isinstance(about['values'], list):
        about['values'] = []
    return about


def has_content(about):
    """Чи людина бодай щось розповіла про себе."""
    return any(about.get(key) for key in EMPTY if key != 'enabled')


def snapshot(about):
    """Профіль для дискусії: лише заповнені поля, без службового `enabled`."""
    return {key: value for key, value in about.items() if key != 'enabled' and value}


def label(kind, key):
    """Підпис варіанта мовою дискусії: AGE/FINANCES/RISK/VALUE."""
    table = {**CHOICES, 'values': VALUE_LABELS}[kind]
    pair = table.get(key)
    return L(*pair) if pair else ''


class AboutSerializer(serializers.Serializer):
    enabled = serializers.BooleanField(required=False)
    location = serializers.CharField(required=False, allow_blank=True, max_length=TEXT_LIMITS['location'])
    age = serializers.CharField(required=False, allow_blank=True, max_length=16)
    family = serializers.CharField(required=False, allow_blank=True, max_length=TEXT_LIMITS['family'])
    occupation = serializers.CharField(
        required=False, allow_blank=True, max_length=TEXT_LIMITS['occupation']
    )
    finances = serializers.CharField(required=False, allow_blank=True, max_length=16)
    finances_note = serializers.CharField(
        required=False, allow_blank=True, max_length=TEXT_LIMITS['finances_note']
    )
    values = serializers.ListField(child=serializers.CharField(max_length=16), required=False)
    risk = serializers.CharField(required=False, allow_blank=True, max_length=16)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=TEXT_LIMITS['notes'])

    def _choice(self, kind, value):
        if value and value not in CHOICES[kind]:
            raise serializers.ValidationError(UNKNOWN_CHOICE)
        return value

    def validate_age(self, value):
        return self._choice('age', value)

    def validate_finances(self, value):
        return self._choice('finances', value)

    def validate_risk(self, value):
        return self._choice('risk', value)

    def validate_values(self, value):
        unique = list(dict.fromkeys(value))
        if any(item not in VALUE_LABELS for item in unique):
            raise serializers.ValidationError(UNKNOWN_CHOICE)
        if len(unique) > VALUES_MAX:
            raise serializers.ValidationError(TOO_MANY_VALUES)
        return unique

    def validate(self, attrs):
        # вільний текст — без зайвих пробілів і порожніх рядків
        for key in TEXT_LIMITS:
            if key in attrs:
                attrs[key] = '\n'.join(
                    ' '.join(line.split()) for line in attrs[key].splitlines() if line.strip()
                )
        return attrs
