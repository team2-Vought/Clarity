import re

from rest_framework import serializers

from .models import Discussion, Message
from .personas import (
    DEFAULT_ROUNDS,
    MAX_AI,
    MAX_ROUNDS,
    MIN_AI,
    PERSONA_BY_SLUG,
    QUESTION_MAX,
    QUESTION_MIN,
)
from .services.catalog import resolve_model

REQUIRED = 'Це поле обов’язкове'
QUESTION_TOO_SHORT = f'Запитання має бути довшим за {QUESTION_MIN} символів'
QUESTION_TOO_LONG = f'Запитання задовге (максимум {QUESTION_MAX} символів)'
PERSONAS_TYPE = 'Повинен бути список персон'
PERSONAS_COUNT = f'Оберіть від {MIN_AI} до {MAX_AI} AI-учасників'
PERSONAS_UNKNOWN = 'Невідома персона: {slug}'
PERSONAS_DUPLICATE = 'Персона «{slug}» обрана двічі'
DEVIL_NOT_ALLOWED = 'AI Devil не є звичайним учасником дискусії'
ROUNDS_RANGE = f'Кількість раундів: від 1 до {MAX_ROUNDS}'
MODE_UNKNOWN = 'Невідомий режим відповіді'
OPTIONS_RANGE = 'Потрібно від 2 до 8 варіантів'
OPTION_TOO_LONG = 'Варіант задовгий (максимум 100 символів)'
OPTION_EMPTY = 'Варіант не може бути порожнім'
OPTION_DUPLICATE = 'Варіанти мають бути різними'
OPTION_NOT_ALLOWED = 'Варіанти потрібні лише для режиму «Один із варіантів»'
STYLE_TOO_LONG = 'Опис характеру задовгий (максимум 300 символів)'
NAME_TOO_LONG = 'Ім’я учасника задовге (максимум 64 символи)'
TEMPERATURE_RANGE = 'Температура має бути від 0 до 1'
MODEL_TOO_LONG = 'Ідентифікатор моделі задовгий (максимум 120 символів)'
MODEL_UNKNOWN = 'Невідома модель: {model}'
MODEL_UNAVAILABLE = 'Модель «{model}» недоступна: додайте ключ у backend/.env або виберіть іншу'
NAMES_DUPLICATE = 'Імена учасників мають бути різними'
NAME_INVALID = 'Ім’я містить недопустимі символи'
TRAITS_TYPE = 'Риси характеру мають бути списком'
TRAITS_TOO_MANY = 'Максимум 20 рис характеру'
TRAIT_TOO_LONG = 'Риса характеру задовга (максимум 40 символів)'

MODES = {m.value for m in Discussion.Mode}
OPTION_MAX = 8
TRAITS_MAX = 20
TRAIT_LENGTH_MAX = 40


class CreateDiscussionSerializer(serializers.Serializer):
    question = serializers.CharField(
        required=True,
        allow_blank=False,
        max_length=QUESTION_MAX,
        error_messages={'required': REQUIRED, 'blank': REQUIRED},
    )
    mode = serializers.ChoiceField(
        choices=Discussion.Mode.choices,
        default=Discussion.Mode.OPEN,
        error_messages={'invalid': MODE_UNKNOWN},
    )
    options = serializers.ListField(
        required=False,
        child=serializers.CharField(max_length=100),
        default=list,
    )
    personas = serializers.ListField(
        required=True,
        error_messages={'required': REQUIRED},
    )
    rounds = serializers.IntegerField(required=False, default=DEFAULT_ROUNDS)

    def validate_question(self, value):
        value = value.replace('\r\n', '\n').replace('\r', '\n')
        lines = [re.sub(r'[ \t]+', ' ', line).strip() for line in value.split('\n')]
        question = '\n'.join(lines).strip()
        question = re.sub(r'\n{3,}', '\n\n', question)
        if len(question) < QUESTION_MIN:
            raise serializers.ValidationError(QUESTION_TOO_SHORT)
        return question

    def validate_options(self, value):
        cleaned = []
        for item in value:
            text = str(item).strip()
            if not text:
                raise serializers.ValidationError(OPTION_EMPTY)
            if len(text) > 100:
                raise serializers.ValidationError(OPTION_TOO_LONG)
            cleaned.append(text)
        folded = [item.casefold() for item in cleaned]
        if len(set(folded)) != len(folded):
            raise serializers.ValidationError(OPTION_DUPLICATE)
        return cleaned

    def validate_personas(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError(PERSONAS_TYPE)
        if not (MIN_AI <= len(value) <= MAX_AI):
            raise serializers.ValidationError(PERSONAS_COUNT)

        seen = set()
        seen_names = set()
        normalized = []
        for item in value:
            if isinstance(item, dict):
                slug = item.get('slug', '')
            elif isinstance(item, str):
                slug = item
            else:
                raise serializers.ValidationError(PERSONAS_TYPE)
            if slug == 'devil':
                raise serializers.ValidationError(DEVIL_NOT_ALLOWED)
            if slug not in PERSONA_BY_SLUG:
                raise serializers.ValidationError(PERSONAS_UNKNOWN.format(slug=slug))
            if slug in seen:
                raise serializers.ValidationError(PERSONAS_DUPLICATE.format(slug=slug))
            seen.add(slug)

            persona = {'slug': slug}
            name = ''
            if isinstance(item, dict):
                name = item.get('name')
                if name:
                    name = ' '.join(str(name).split())
                    if re.search(r'[\x00-\x1f\x7f]', name):
                        raise serializers.ValidationError(NAME_INVALID)
                    if len(name) > 64:
                        raise serializers.ValidationError(NAME_TOO_LONG)
                    if name:
                        persona['name'] = name
                else:
                    name = ''
                style = item.get('style')
                if style:
                    style = str(style).strip()
                    if len(style) > 300:
                        raise serializers.ValidationError(STYLE_TOO_LONG)
                    persona['style'] = style
                traits = item.get('traits')
                if traits is not None:
                    if not isinstance(traits, list):
                        raise serializers.ValidationError(TRAITS_TYPE)
                    cleaned_traits = []
                    for trait in traits:
                        text = str(trait).strip()
                        if not text:
                            continue
                        if len(text) > TRAIT_LENGTH_MAX:
                            raise serializers.ValidationError(TRAIT_TOO_LONG)
                        if text not in cleaned_traits:
                            cleaned_traits.append(text)
                    if len(cleaned_traits) > TRAITS_MAX:
                        raise serializers.ValidationError(TRAITS_TOO_MANY)
                    if cleaned_traits:
                        persona['traits'] = cleaned_traits
                model = item.get('model')
                if model:
                    model = str(model).strip()
                    if len(model) > 120:
                        raise serializers.ValidationError(MODEL_TOO_LONG)
                    spec = resolve_model(model)
                    if spec is None:
                        raise serializers.ValidationError(
                            MODEL_UNKNOWN.format(model=model)
                        )
                    if not spec.get('available'):
                        raise serializers.ValidationError(
                            MODEL_UNAVAILABLE.format(model=model)
                        )
                    persona['model'] = model
                temperature = item.get('temperature')
                if temperature is not None:
                    try:
                        temperature = float(temperature)
                    except (TypeError, ValueError):
                        raise serializers.ValidationError(TEMPERATURE_RANGE)
                    if not (0 <= temperature <= 1):
                        raise serializers.ValidationError(TEMPERATURE_RANGE)
                    persona['temperature'] = temperature
            effective_name = name or PERSONA_BY_SLUG[slug]['name']
            folded_name = effective_name.casefold()
            if folded_name in seen_names:
                raise serializers.ValidationError(NAMES_DUPLICATE)
            seen_names.add(folded_name)
            normalized.append(persona)
        return normalized

    def validate_rounds(self, value):
        if not (1 <= value <= MAX_ROUNDS):
            raise serializers.ValidationError(ROUNDS_RANGE)
        return value

    def validate(self, attrs):
        mode = attrs.get('mode', Discussion.Mode.OPEN)
        options = attrs.get('options') or []

        if mode == Discussion.Mode.CHOOSE_ONE:
            if not (2 <= len(options) <= OPTION_MAX):
                raise serializers.ValidationError({'options': OPTIONS_RANGE})
        elif options:
            raise serializers.ValidationError({'options': OPTION_NOT_ALLOWED})
        return attrs


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = [
            'id',
            'seq',
            'phase',
            'round',
            'role',
            'persona_slug',
            'persona_name',
            'avatar',
            'color',
            'reply_to',
            'reply_to_slug',
            'content',
            'thesis',
            'stance',
            'created_at',
        ]


class DiscussionSerializer(serializers.ModelSerializer):
    messages = MessageSerializer(many=True, read_only=True)
    is_finished = serializers.BooleanField(read_only=True)

    class Meta:
        model = Discussion
        fields = [
            'id',
            'question',
            'mode',
            'options',
            'personas',
            'rounds',
            'status',
            'phase',
            'current_round',
            'speaker_index',
            'early_stop',
            'is_finished',
            'best_solution',
            'devil_review',
            'final_summary',
            'messages',
            'created_at',
            'finished_at',
        ]


class DiscussionListSerializer(serializers.ModelSerializer):
    message_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Discussion
        fields = [
            'id',
            'question',
            'mode',
            'rounds',
            'status',
            'phase',
            'message_count',
            'created_at',
            'finished_at',
        ]
