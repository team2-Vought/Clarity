import re

from django.conf import settings
from rest_framework import serializers

from .models import Discussion, Message, Team
from .personas import (
    DEFAULT_ROUNDS,
    MAX_AI,
    MAX_ROUNDS,
    MIN_AI,
    PERSONA_BY_SLUG,
    QUESTION_MAX,
    QUESTION_MIN,
)
from .services import engine, runner, search
from .services.catalog import resolve_model

REQUIRED = 'Це поле обов’язкове'
QUESTION_TOO_SHORT = f'Запитання має містити щонайменше {QUESTION_MIN} символів'
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
NAME_TOO_LONG = 'Ім’я учасника задовге (максимум 64 символи)'
MODEL_TOO_LONG = 'Ідентифікатор моделі задовгий (максимум 120 символів)'
MODEL_UNKNOWN = 'Невідома модель: {model}'
MODEL_UNAVAILABLE = 'Модель «{model}» недоступна: додайте ключ у backend/.env або виберіть іншу'
NAMES_DUPLICATE = 'Імена учасників мають бути різними'
DEFAULT_NAME = 'Учасник {index}'
NAME_INVALID = 'Ім’я містить недопустимі символи'
TRAITS_TYPE = 'Риси характеру мають бути списком'
TRAITS_TOO_MANY = 'Максимум 20 рис характеру'
TRAIT_TOO_LONG = 'Риса характеру задовга (максимум 40 символів)'
SEARCH_UNAVAILABLE = 'Пошук в інтернеті вимкнено на сервері'
PERSONA_NOT_IN_DISCUSSION = 'Учасника «{slug}» немає в цій дискусії'
TEAM_NAME_EMPTY = 'Назвіть команду'
TEAM_NAME_TOO_LONG = 'Назва команди задовга (максимум 64 символи)'
SHARED_AUTHOR = 'Автор питання'
CLARIFICATIONS_TYPE = 'Уточнення мають бути списком пар «питання — відповідь»'
CLARIFICATION_TOO_LONG = 'Відповідь на уточнення задовга (максимум 500 символів)'

# Помилки, які не минуть від повтору: потрібно змінити модель чи налаштування.
NON_RETRYABLE_CODES = {
    'provider_config',
    'provider_quota',
    'no_personas',
    'bad_state',
    'not_found',
    'daily_limit',
    'followup_limit',
}

MODES = {m.value for m in Discussion.Mode}
TITLE_LIMIT = 90
_SENTENCE_END = re.compile(r'(?<=[.!?…])\s')
OPTION_MAX = 8
TRAITS_MAX = 20
TRAIT_LENGTH_MAX = 40
CLARIFICATIONS_MAX = 6
CLARIFICATION_QUESTION_MAX = 300
CLARIFICATION_ANSWER_MAX = 500


def validate_model_id(value):
    """Порожньо — автоматичний вибір; інакше модель має бути в каталозі й доступна."""
    model = str(value or '').strip()
    if not model:
        return ''
    if len(model) > 120:
        raise serializers.ValidationError(MODEL_TOO_LONG)
    spec = resolve_model(model)
    if spec is None:
        raise serializers.ValidationError(MODEL_UNKNOWN.format(model=model))
    if not spec.get('available'):
        raise serializers.ValidationError(MODEL_UNAVAILABLE.format(model=model))
    return model


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
    web_search = serializers.BooleanField(required=False, default=False)
    moderator_model = serializers.CharField(required=False, allow_blank=True, default='')
    devil_model = serializers.CharField(required=False, allow_blank=True, default='')
    def validate_web_search(self, value):
        if value and not search.is_available():
            raise serializers.ValidationError(SEARCH_UNAVAILABLE)
        return value

    def validate_moderator_model(self, value):
        return validate_model_id(value)

    def validate_devil_model(self, value):
        return validate_model_id(value)

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
        for index, item in enumerate(value):
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
                # Власний стиль і температуру з інтерфейсу прибрано: нові значення
                # мовчки ігноруємо (старі клієнти не отримують помилку), а вже
                # збережені в старих дискусіях рушій і далі враховує.
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
                model = validate_model_id(item.get('model'))
                if model:
                    persona['model'] = model
            # Користувач не бачить архетипів персон («Логік», «Скептик»), лише
            # своїх учасників, тож безіменному даємо те саме ім'я, що й в UI.
            effective_name = name or DEFAULT_NAME.format(index=index + 1)
            persona['name'] = effective_name
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
            'search_query',
            'source_ids',
            'model_id',
            'created_at',
        ]


class UpdateDiscussionSerializer(serializers.Serializer):
    """Зміна моделей, поки дискусія не виконується (наприклад, після помилки ключа)."""

    personas = serializers.ListField(child=serializers.DictField(), required=False)
    moderator_model = serializers.CharField(required=False, allow_blank=True)
    devil_model = serializers.CharField(required=False, allow_blank=True)
    pinned = serializers.BooleanField(required=False)
    archived = serializers.BooleanField(required=False)

    def validate_personas(self, value):
        result = {}
        for item in value:
            slug = str(item.get('slug', ''))
            if not slug:
                raise serializers.ValidationError(PERSONAS_TYPE)
            result[slug] = validate_model_id(item.get('model'))
        return result

    def validate_moderator_model(self, value):
        return validate_model_id(value)

    def validate_devil_model(self, value):
        return validate_model_id(value)

    def update(self, instance, validated_data):
        models = validated_data.get('personas') or {}
        known = {
            (item.get('slug') if isinstance(item, dict) else str(item))
            for item in instance.personas
        }
        unknown = [slug for slug in models if slug not in known]
        if unknown:
            raise serializers.ValidationError(
                {'personas': PERSONA_NOT_IN_DISCUSSION.format(slug=unknown[0])}
            )
        personas = []
        for item in instance.personas:
            persona = dict(item) if isinstance(item, dict) else {'slug': str(item)}
            if persona['slug'] in models:
                if models[persona['slug']]:
                    persona['model'] = models[persona['slug']]
                else:
                    persona.pop('model', None)
            personas.append(persona)
        instance.personas = personas
        for field in ('moderator_model', 'devil_model', 'pinned', 'archived'):
            if field in validated_data:
                setattr(instance, field, validated_data[field])
        changed_models = bool(models) or {'moderator_model', 'devil_model'} & set(validated_data)
        if changed_models and instance.status == Discussion.Status.FAILED:
            # нова модель — нова спроба: прибираємо стару помилку
            instance.error_code = ''
            instance.error_public = ''
        instance.save()
        return instance


def discussion_title(question):
    """Коротка назва: перше речення першого рядка запитання (до 90 символів)."""
    first = (question or '').strip().split('\n', 1)[0]
    sentence = _SENTENCE_END.split(first, maxsplit=1)[0].strip()
    if len(sentence) <= TITLE_LIMIT:
        return sentence
    return sentence[:TITLE_LIMIT].rsplit(' ', 1)[0].rstrip(' ,;:—-') + '…'


class DiscussionSerializer(serializers.ModelSerializer):
    """Повний стан дискусії. З context['after'] повертає лише нові повідомлення."""

    messages = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    is_finished = serializers.BooleanField(read_only=True)
    is_running = serializers.SerializerMethodField()
    retryable = serializers.SerializerMethodField()
    search = serializers.SerializerMethodField()
    max_followups = serializers.SerializerMethodField()
    thinking = serializers.SerializerMethodField()
    live = serializers.SerializerMethodField()

    def get_messages(self, obj):
        queryset = obj.messages.order_by('seq')
        after = self.context.get('after')
        if after is not None:
            queryset = queryset.filter(seq__gt=after)
        return MessageSerializer(queryset, many=True).data

    def get_is_running(self, obj):
        return runner.is_working(obj)

    def get_title(self, obj):
        return discussion_title(obj.question)

    def get_retryable(self, obj):
        return obj.error_code not in NON_RETRYABLE_CODES

    def get_search(self, obj):
        return search.status()

    def get_max_followups(self, obj):
        return int(settings.DISCUSSION_MAX_FOLLOWUPS)

    def get_thinking(self, obj):
        return engine.describe_step(obj)

    def get_live(self, obj):
        """Живий статус поточного кроку: {status, search}; порожньо між кроками."""
        if not obj.live_token or obj.live_token != obj.advance_token or not engine.is_running(obj):
            return {'status': '', 'search': ''}
        return {'status': obj.live_status, 'search': obj.live_search}

    class Meta:
        model = Discussion
        fields = [
            'id',
            'title',
            'question',
            'mode',
            'options',
            'clarifications',
            'clarify_questions',
            'personas',
            'rounds',
            'web_search',
            'sources',
            'moderator_model',
            'devil_model',
            'followups',
            'max_followups',
            'stop_requested',
            'pinned',
            'archived',
            'share_token',
            'status',
            'phase',
            'current_round',
            'speaker_index',
            'early_stop',
            'finished_early',
            'is_finished',
            'is_running',
            'error_code',
            'error_public',
            'retryable',
            'search',
            'best_solution',
            'devil_review',
            'final_summary',
            'thinking',
            'live',
            'messages',
            'created_at',
            'finished_at',
        ]


PREVIEW_LIMIT = 240
# розмітка markdown у прев'ю не потрібна — лишаємо чистий текст
PREVIEW_MARKUP = re.compile(r'[*_`#>~]+|\[(?=[^\]]*\]\()|\]\([^)]*\)')


def _preview(text):
    text = PREVIEW_MARKUP.sub('', text or '')
    text = ' '.join(text.split())
    if len(text) <= PREVIEW_LIMIT:
        return text
    return text[:PREVIEW_LIMIT].rsplit(' ', 1)[0] + '…'


class DiscussionListSerializer(serializers.ModelSerializer):
    message_count = serializers.IntegerField(read_only=True)
    preview = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    is_running = serializers.SerializerMethodField()

    class Meta:
        model = Discussion
        fields = [
            'id',
            'title',
            'question',
            'mode',
            'rounds',
            'current_round',
            'status',
            'phase',
            'is_running',
            'pinned',
            'archived',
            'message_count',
            'preview',
            'created_at',
            'finished_at',
        ]

    def get_title(self, obj):
        return discussion_title(obj.question)

    def get_is_running(self, obj):
        return runner.is_working(obj)

    def get_preview(self, obj):
        """Фрагмент відповіді: фінальне рішення, інакше остання репліка або помилка."""
        for source in (obj.final_summary, obj.best_solution):
            if isinstance(source, dict) and source.get('decision'):
                return _preview(source['decision'])
        last_reply = getattr(obj, 'last_reply', None)
        if last_reply:
            return _preview(last_reply)
        if obj.status == Discussion.Status.FAILED:
            return _preview(obj.error_public)
        return ''


class SharedMessageSerializer(MessageSerializer):
    """Репліка для публічного посилання: ім'я автора питання не розкриваємо."""

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.role == Message.Role.USER:
            data['persona_name'] = SHARED_AUTHOR
        if instance.reply_to_slug == engine.USER_SLUG:
            data['reply_to'] = SHARED_AUTHOR
        return data


class SharedDiscussionSerializer(serializers.ModelSerializer):
    """Дискусія за публічним посиланням: лише читання, без службових полів."""

    title = serializers.SerializerMethodField()
    personas = serializers.SerializerMethodField()
    messages = serializers.SerializerMethodField()

    class Meta:
        model = Discussion
        fields = [
            'title',
            'question',
            'mode',
            'options',
            'clarifications',
            'personas',
            'rounds',
            'status',
            'phase',
            'early_stop',
            'finished_early',
            'current_round',
            'sources',
            'final_summary',
            'messages',
            'created_at',
            'finished_at',
        ]

    def get_title(self, obj):
        return discussion_title(obj.question)

    def get_personas(self, obj):
        # власний стиль — це інструкції користувача для моделі, їх не показуємо
        return [
            {
                'slug': item.get('slug', ''),
                'name': item.get('name', ''),
                'model': item.get('model', ''),
                'traits': item.get('traits', []),
            }
            for item in obj.personas
            if isinstance(item, dict)
        ]

    def get_messages(self, obj):
        return SharedMessageSerializer(obj.messages.order_by('seq'), many=True).data


class TeamSerializer(serializers.ModelSerializer):
    """Збережена команда: склад учасників перевіряється так само, як при створенні дискусії."""

    personas = serializers.ListField(required=True, error_messages={'required': REQUIRED})
    moderator_model = serializers.CharField(required=False, allow_blank=True, default='')
    devil_model = serializers.CharField(required=False, allow_blank=True, default='')

    class Meta:
        model = Team
        fields = ['id', 'name', 'personas', 'moderator_model', 'devil_model', 'updated_at']
        read_only_fields = ['id', 'updated_at']

    def validate_name(self, value):
        name = ' '.join(str(value or '').split())
        if not name:
            raise serializers.ValidationError(TEAM_NAME_EMPTY)
        if len(name) > 64:
            raise serializers.ValidationError(TEAM_NAME_TOO_LONG)
        if re.search(r'[\x00-\x1f\x7f]', name):
            raise serializers.ValidationError(NAME_INVALID)
        return name

    def validate_personas(self, value):
        return CreateDiscussionSerializer().validate_personas(value)

    def validate_moderator_model(self, value):
        return validate_model_id(value)

    def validate_devil_model(self, value):
        return validate_model_id(value)


class ClarifyAnswersSerializer(serializers.Serializer):
    """Відповіді на питання модератора: [{question, answer}]; порожньо — пропустити."""

    answers = serializers.ListField(required=False, default=list)

    def validate_answers(self, value):
        """Порожні відповіді (користувач пропустив питання) відкидаємо."""
        cleaned = []
        for item in value[:CLARIFICATIONS_MAX]:
            if not isinstance(item, dict):
                raise serializers.ValidationError(CLARIFICATIONS_TYPE)
            question = ' '.join(str(item.get('question') or '').split())
            answer = ' '.join(str(item.get('answer') or '').split())
            if len(answer) > CLARIFICATION_ANSWER_MAX:
                raise serializers.ValidationError(CLARIFICATION_TOO_LONG)
            if question and answer:
                cleaned.append(
                    {'question': question[:CLARIFICATION_QUESTION_MAX], 'answer': answer}
                )
        return cleaned
