import re

from django.conf import settings
from rest_framework import serializers

from backend.i18n import L, lazy_L

from .models import CustomPersona, Discussion, Message, Team
from .personas import (
    DEFAULT_ROUNDS,
    MAX_AI,
    MAX_ROUNDS,
    MIN_ROUNDS,
    MIN_AI,
    PERSONA_BY_SLUG,
    QUESTION_MAX,
    QUESTION_MIN,
)
from .attachment_views import attachment_payload
from .services.criteria import CRITERIA_MAX, WEIGHT_MAX, WEIGHT_MIN
from .services.criteria import NAME_MAX as CRITERION_NAME_MAX
from .journal import journal_state
from .services import engine, runner, search
from .services.catalog import resolve_model

REQUIRED = lazy_L('Це поле обов’язкове', 'This field is required')
QUESTION_TOO_SHORT = lazy_L(
    f'Запитання має містити щонайменше {QUESTION_MIN} символів',
    f'The question must be at least {QUESTION_MIN} characters long',
)
QUESTION_TOO_LONG = lazy_L(
    f'Запитання задовге (максимум {QUESTION_MAX} символів)',
    f'The question is too long (maximum {QUESTION_MAX} characters)',
)
PERSONAS_TYPE = lazy_L('Повинен бути список персон', 'Must be a list of personas')
PERSONAS_COUNT = lazy_L(
    f'Оберіть від {MIN_AI} до {MAX_AI} AI-учасників',
    f'Choose from {MIN_AI} to {MAX_AI} AI participants',
)
PERSONAS_UNKNOWN = lazy_L('Невідома персона: {slug}', 'Unknown persona: {slug}')
PERSONAS_DUPLICATE = lazy_L('Персона «{slug}» обрана двічі', 'The persona “{slug}” is selected twice')
DEVIL_NOT_ALLOWED = lazy_L(
    'AI Devil не є звичайним учасником дискусії', 'AI Devil is not a regular discussion participant'
)
ROUNDS_RANGE = lazy_L(
    f'Кількість раундів: від {MIN_ROUNDS} до {MAX_ROUNDS}',
    f'Number of rounds: from {MIN_ROUNDS} to {MAX_ROUNDS}',
)
MODE_UNKNOWN = lazy_L('Невідомий режим відповіді', 'Unknown answer format')
OPTIONS_RANGE = lazy_L('Потрібно від 2 до 8 варіантів', 'From 2 to 8 options are required')
OPTION_TOO_LONG = lazy_L('Варіант задовгий (максимум 100 символів)', 'The option is too long (maximum 100 characters)')
OPTION_EMPTY = lazy_L('Варіант не може бути порожнім', 'An option cannot be empty')
OPTION_DUPLICATE = lazy_L('Варіанти мають бути різними', 'Options must be different')
OPTION_NOT_ALLOWED = lazy_L(
    'Варіанти потрібні лише для режиму «Один із варіантів»',
    'Options are only needed for the “One of the options” format',
)
NAME_TOO_LONG = lazy_L(
    'Ім’я учасника задовге (максимум 64 символи)',
    'The participant name is too long (maximum 64 characters)',
)
MODEL_TOO_LONG = lazy_L(
    'Ідентифікатор моделі задовгий (максимум 120 символів)',
    'The model identifier is too long (maximum 120 characters)',
)
MODEL_UNKNOWN = lazy_L('Невідома модель: {model}', 'Unknown model: {model}')
MODEL_UNAVAILABLE = lazy_L(
    'Модель «{model}» недоступна: додайте ключ у backend/.env або виберіть іншу',
    'The model “{model}” is unavailable: add a key in backend/.env or choose another one',
)
NAMES_DUPLICATE = lazy_L('Імена учасників мають бути різними', 'Participant names must be different')
DEFAULT_NAME = lazy_L('Учасник {index}', 'Participant {index}')
NAME_INVALID = lazy_L('Ім’я містить недопустимі символи', 'The name contains invalid characters')
TRAITS_TYPE = lazy_L('Риси характеру мають бути списком', 'Character traits must be a list')
TRAITS_TOO_MANY = lazy_L('Максимум 20 рис характеру', 'A maximum of 20 character traits')
TRAIT_TOO_LONG = lazy_L(
    'Риса характеру задовга (максимум 40 символів)',
    'The character trait is too long (maximum 40 characters)',
)
SEARCH_UNAVAILABLE = lazy_L('Пошук в інтернеті вимкнено на сервері', 'Web search is disabled on the server')
PERSONA_NOT_IN_DISCUSSION = lazy_L(
    'Учасника «{slug}» немає в цій дискусії', 'The participant “{slug}” is not in this discussion'
)
TEAM_NAME_EMPTY = lazy_L('Назвіть команду', 'Name the team')
TEAM_NAME_TOO_LONG = lazy_L(
    'Назва команди задовга (максимум 64 символи)', 'The team name is too long (maximum 64 characters)'
)
SHARED_AUTHOR = lazy_L('Автор питання', 'Question author')
CLARIFICATIONS_TYPE = lazy_L(
    'Уточнення мають бути списком пар «питання — відповідь»',
    'Clarifications must be a list of “question — answer” pairs',
)
CLARIFICATION_TOO_LONG = lazy_L(
    'Відповідь на уточнення задовга (максимум 500 символів)',
    'The clarification answer is too long (maximum 500 characters)',
)

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
    # раунди тривають, доки всі не зійдуться (до CONSENSUS_MAX_ROUNDS); rounds тоді ігнорується
    until_consensus = serializers.BooleanField(required=False, default=False)
    web_search = serializers.BooleanField(required=False, default=False)
    moderator_model = serializers.CharField(required=False, allow_blank=True, default='')
    devil_model = serializers.CharField(required=False, allow_blank=True, default='')
    # врахувати «Про мене»; без поля — як задано в самому профілі
    use_profile = serializers.BooleanField(required=False)
    # швидкий режим: одна коротка відповідь без дебатів
    quick = serializers.BooleanField(required=False, default=False)
    # критерії для «Один із варіантів»: [{name, weight 1–5}]
    criteria = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    # завантажені заздалегідь вкладення (POST /api/attachments/)
    attachments = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )

    def validate_criteria(self, value):
        if len(value) > CRITERIA_MAX:
            raise serializers.ValidationError(L(
                f'Можна задати не більше {CRITERIA_MAX} критеріїв',
                f'You can set no more than {CRITERIA_MAX} criteria',
            ))
        cleaned, seen = [], set()
        for item in value:
            name = ' '.join(str(item.get('name') or '').split())
            if not name:
                continue
            if len(name) > CRITERION_NAME_MAX:
                raise serializers.ValidationError(L(
                    f'Назва критерію — до {CRITERION_NAME_MAX} символів',
                    f'A criterion name is up to {CRITERION_NAME_MAX} characters',
                ))
            if name.casefold() in seen:
                raise serializers.ValidationError(L('Критерії мають бути різними', 'Criteria must be different'))
            seen.add(name.casefold())
            try:
                weight = int(item.get('weight', 3))
            except (TypeError, ValueError):
                weight = 3
            cleaned.append({'name': name, 'weight': max(WEIGHT_MIN, min(WEIGHT_MAX, weight))})
        return cleaned

    def validate_attachments(self, value):
        value = list(dict.fromkeys(value))
        if len(value) > settings.ATTACHMENTS_MAX:
            raise serializers.ValidationError(L(
                f'Можна додати не більше {settings.ATTACHMENTS_MAX} файлів',
                f'You can add no more than {settings.ATTACHMENTS_MAX} files',
            ))
        return value

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

    def _custom_roles(self):
        """Свої ролі автора: {slug: CustomPersona}; без користувача в контексті — жодних."""
        user = self.context.get('user') if hasattr(self, 'context') else None
        if user is None:
            return {}
        return {role.slug: role for role in CustomPersona.objects.filter(user=user)}

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
            custom = self._custom_roles().get(slug)
            if slug not in PERSONA_BY_SLUG and custom is None:
                raise serializers.ValidationError(PERSONAS_UNKNOWN.format(slug=slug))
            if slug in seen:
                raise serializers.ValidationError(PERSONAS_DUPLICATE.format(slug=slug))
            seen.add(slug)

            persona = {'slug': slug}
            if custom is not None:
                # копія ролі: зміна чи видалення ролі не переписує старих дискусій
                persona['custom'] = {'name': custom.name, 'description': custom.description}
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
            # своя роль без окремого імені зветься назвою ролі — «Юрист», а не «Учасник 3»
            effective_name = name or (custom.name if custom else DEFAULT_NAME.format(index=index + 1))
            persona['name'] = effective_name
            folded_name = effective_name.casefold()
            if folded_name in seen_names:
                raise serializers.ValidationError(NAMES_DUPLICATE)
            seen_names.add(folded_name)
            normalized.append(persona)
        return normalized

    def validate_rounds(self, value):
        if not (MIN_ROUNDS <= value <= MAX_ROUNDS):
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
        # критерії мають сенс лише для вибору з варіантів
        if mode != Discussion.Mode.CHOOSE_ONE:
            attrs['criteria'] = []
        return attrs


class MessageSerializer(serializers.ModelSerializer):
    # файли, додані до уточнення в чаті (без самого тексту документа)
    attachments = serializers.SerializerMethodField()

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
            'attachments',
        ]

    def get_attachments(self, obj):
        return [attachment_payload(item) for item in obj.attachments.all()]


class MessageCreateSerializer(serializers.Serializer):
    """Уточнення в чаті: текст і адресата перевіряє рушій, тут — лише прапорець і файли."""

    quick = serializers.BooleanField(required=False, default=False)
    attachments = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )

    def validate_attachments(self, value):
        value = list(dict.fromkeys(value))
        if len(value) > settings.ATTACHMENTS_MAX:
            raise serializers.ValidationError(L(
                f'Можна додати не більше {settings.ATTACHMENTS_MAX} файлів',
                f'You can add no more than {settings.ATTACHMENTS_MAX} files',
            ))
        return value


class UpdateDiscussionSerializer(serializers.Serializer):
    """Зміна моделей, поки дискусія не виконується (наприклад, після помилки ключа)."""

    personas = serializers.ListField(child=serializers.DictField(), required=False)
    moderator_model = serializers.CharField(required=False, allow_blank=True)
    devil_model = serializers.CharField(required=False, allow_blank=True)
    pinned = serializers.BooleanField(required=False)
    archived = serializers.BooleanField(required=False)
    # пошук в інтернеті можна ввімкнути чи вимкнути й посеред дискусії
    web_search = serializers.BooleanField(required=False)

    def validate_web_search(self, value):
        if value and not search.is_available():
            raise serializers.ValidationError(SEARCH_UNAVAILABLE)
        return value

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
        for field in ('moderator_model', 'devil_model', 'pinned', 'archived', 'web_search'):
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
    max_direct = serializers.SerializerMethodField()
    thinking = serializers.SerializerMethodField()
    live = serializers.SerializerMethodField()
    # сам профіль клієнту не потрібен — лише те, що його враховано
    profile_used = serializers.SerializerMethodField()
    journal = serializers.SerializerMethodField()
    attachments = serializers.SerializerMethodField()

    def get_messages(self, obj):
        queryset = obj.messages.order_by('seq').prefetch_related('attachments')
        after = self.context.get('after')
        if after is not None:
            queryset = queryset.filter(seq__gt=after)
        return MessageSerializer(queryset, many=True).data

    def get_is_running(self, obj):
        return runner.is_working(obj)

    def get_profile_used(self, obj):
        return bool(obj.profile)

    def get_journal(self, obj):
        return journal_state(obj)

    def get_attachments(self, obj):
        # файли самого питання; додані до уточнень — у своїх повідомленнях
        return [attachment_payload(item) for item in obj.attachments.filter(message__isnull=True)]

    def get_title(self, obj):
        return discussion_title(obj.question)

    def get_retryable(self, obj):
        return obj.error_code not in NON_RETRYABLE_CODES

    def get_search(self, obj):
        return search.status()

    def get_max_followups(self, obj):
        return int(settings.DISCUSSION_MAX_FOLLOWUPS)

    def get_max_direct(self, obj):
        return int(settings.DISCUSSION_MAX_DIRECT)

    def get_thinking(self, obj):
        return engine.describe_step(obj)

    def get_live(self, obj):
        """Живий статус поточного кроку: {status, search, drafts}; порожньо між кроками.

        drafts — репліки, які моделі ще пишуть (лише з текстом)."""
        if not obj.live_token or obj.live_token != obj.advance_token or not engine.is_running(obj):
            return {'status': '', 'search': '', 'drafts': []}
        drafts = [
            draft for draft in (obj.live_drafts or [])
            if isinstance(draft, dict) and draft.get('text')
        ]
        return {'status': obj.live_status, 'search': obj.live_search, 'drafts': drafts}

    class Meta:
        model = Discussion
        fields = [
            'id',
            'title',
            'question',
            'language',
            'mode',
            'options',
            'clarifications',
            'clarify_questions',
            'profile_used',
            'journal',
            'attachments',
            'personas',
            'rounds',
            'until_consensus',
            'web_search',
            'sources',
            'moderator_model',
            'devil_model',
            'followups',
            'max_followups',
            'direct_questions',
            'max_direct',
            'quick',
            'safety',
            'criteria',
            'matrix',
            'feedback',
            'feedback_note',
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
            'until_consensus',
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
    """Репліка для публічного посилання: ім'я автора питання не розкриваємо,
    а файлів уточнень не показуємо зовсім."""

    class Meta(MessageSerializer.Meta):
        fields = [name for name in MessageSerializer.Meta.fields if name != 'attachments']

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
            'until_consensus',
            'status',
            'phase',
            'early_stop',
            'finished_early',
            'current_round',
            'sources',
            'quick',
            'criteria',
            'matrix',
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
        return CreateDiscussionSerializer(context=self.context).validate_personas(value)

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


class CustomPersonaSerializer(serializers.ModelSerializer):
    slug = serializers.CharField(read_only=True)

    class Meta:
        model = CustomPersona
        fields = ['id', 'slug', 'name', 'description', 'created_at']
        read_only_fields = ['id', 'slug', 'created_at']

    def validate_name(self, value):
        name = ' '.join(value.split())
        if len(name) < 2:
            raise serializers.ValidationError(L('Назва ролі — щонайменше 2 символи', 'A role name needs at least 2 characters'))
        return name

    def validate_description(self, value):
        text = ' '.join(value.split())
        if len(text) < 10:
            raise serializers.ValidationError(L(
                'Опишіть роль хоча б одним реченням: хто це і як міркує',
                'Describe the role in at least one sentence: who it is and how it thinks',
            ))
        return text


class FeedbackSerializer(serializers.Serializer):
    """«Допомогло / не допомогло» під висновком; порожнє value — скасувати оцінку."""

    value = serializers.ChoiceField(choices=[('', ''), *Discussion.Feedback.choices])
    note = serializers.CharField(required=False, allow_blank=True, max_length=500)
