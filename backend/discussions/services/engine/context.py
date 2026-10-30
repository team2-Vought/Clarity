"""Стан дискусії для кроку: повідомлення, хто говорить, кому відповідає, якими моделями."""

from __future__ import annotations

from collections import Counter

from django.conf import settings

from ...models import Discussion, Message
from ...personas import localize, moderator
from ..catalog import available_model_ids, default_model_id, resolve_model
from .base import DEFAULT_TEMPERATURE, MAX_SEQ_STEP, USER_SLUG
from .parsing import _text, _text_list


def _next_seq(discussion):
    last = discussion.messages.order_by('-seq').values_list('seq', flat=True).first()
    return (last or 0) + MAX_SEQ_STEP


def _add_message(
    discussion,
    *,
    persona,
    role,
    phase,
    content,
    debate_round=None,
    reply_to='',
    reply_to_slug='',
    thesis='',
    stance='',
    search_query='',
    source_ids=None,
    model_id='',
):
    return Message.objects.create(
        discussion=discussion,
        seq=_next_seq(discussion),
        phase=phase,
        round=debate_round,
        role=role,
        persona_slug=persona['slug'],
        persona_name=persona['name'],
        avatar=persona['avatar'],
        color=persona.get('color', ''),
        content=content,
        reply_to=reply_to,
        reply_to_slug=reply_to_slug,
        thesis=thesis,
        stance=stance,
        search_query=search_query[:300],
        source_ids=source_ids or [],
        model_id=model_id[:120],
    )


def _list_messages(discussion):
    return list(discussion.messages.order_by('seq'))


def _question_message(messages):
    return next((message for message in messages if message.role == Message.Role.USER), None)


def _user_notes(messages):
    """Уточнення користувача — усі його повідомлення, крім самого запитання."""
    question = _question_message(messages)
    return [
        message
        for message in messages
        if message.role == Message.Role.USER and message is not question
    ]


def _notes_since(messages, seq):
    return [note for note in _user_notes(messages) if note.seq > seq]


def _speaker_order(personas, debate_round):
    """Порядок виступів у раунді: зсув на один щораунду."""
    if not personas:
        return []
    shift = (max(1, debate_round or 1) - 1) % len(personas)
    return personas[shift:] + personas[:shift]


def _reply_target(messages, persona):
    """Обирає, кому відповідає учасник у раунді дебатів.

    Пріоритет: уточнення користувача, на яке ще ніхто не відповів → незакрите
    звернення до мовця → не той самий співрозмовник, що минулого разу →
    учасник з іншою позицією → той, кому мовець ще не відповідав →
    найсвіжіша репліка. Повертає (Message | None, причина).
    """
    slug = persona['slug']
    ai = [
        message
        for message in messages
        if message.role == Message.Role.AI
        and message.phase in {Discussion.Phase.OPENING, Discussion.Phase.DEBATE}
    ]
    mine = [message for message in ai if message.persona_slug == slug]
    my_last_seq = mine[-1].seq if mine else 0

    for note in reversed(_notes_since(messages, my_last_seq)):
        answered = any(
            message.reply_to_slug == USER_SLUG and message.seq > note.seq
            for message in messages
        )
        if not answered:
            return note, 'user'

    my_last_target = mine[-1].reply_to_slug if mine else ''
    my_stance = next((message.stance for message in reversed(mine) if message.stance), '')
    replied = {message.reply_to_slug for message in mine if message.reply_to_slug}

    latest = {}
    for message in ai:
        if message.persona_slug != slug:
            latest[message.persona_slug] = message

    best = (None, '')
    best_key = None
    for other_slug, message in latest.items():
        addressed = next(
            (
                item
                for item in reversed(ai)
                if item.persona_slug == other_slug
                and item.reply_to_slug == slug
                and item.seq > my_last_seq
            ),
            None,
        )
        disagree = bool(my_stance and message.stance and message.stance != my_stance)
        key = (
            addressed is not None,
            other_slug != my_last_target,
            disagree,
            other_slug not in replied,
            message.seq,
        )
        if best_key is None or key > best_key:
            best_key = key
            if addressed is not None:
                best = (addressed, 'question')
            else:
                best = (message, 'disagree' if disagree else 'new')
    return best


def _default_model():
    return default_model_id() or settings.LLM_DEFAULT_MODEL


def _is_available(model_id):
    if not model_id:
        return False
    spec = resolve_model(model_id)
    return bool(spec and spec.get('available'))


def _judge_models(discussion, personas, role):
    """Моделі для модератора чи Devil у порядку спроб.

    Явний вибір користувача → налаштування → модель, якої немає в жодного
    учасника (неупереджений суддя) → найпоширеніша модель учасників → решта
    доступних. Devil уникає моделі модератора, щоб не перевіряти сам себе.
    """
    persona_models = [persona.get('model') for persona in personas if persona.get('model')]
    counts = Counter(persona_models)
    if role == 'devil':
        explicit = [discussion.devil_model, getattr(settings, 'LLM_DEVIL_MODEL', '')]
    else:
        explicit = [discussion.moderator_model, getattr(settings, 'LLM_MODERATOR_MODEL', '')]
    available = available_model_ids()
    neutral = [model_id for model_id in available if model_id not in counts]
    popular = [model_id for model_id, _ in counts.most_common()]

    candidates = []
    for model_id in [*explicit, *neutral, *popular, *available, _default_model()]:
        if model_id and model_id not in candidates and _is_available(model_id):
            candidates.append(model_id)
    if role == 'devil':
        moderator = (_judge_models(discussion, personas, 'moderator') or [''])[0]
        if not (discussion.devil_model or getattr(settings, 'LLM_DEVIL_MODEL', '')):
            candidates.sort(key=lambda model_id: model_id == moderator)
    if not candidates:
        candidates = [model_id for model_id in [*persona_models, _default_model()] if model_id]
    return candidates


def _resolved_personas(discussion):
    """Повертає персон з усіма user-оверайдами: name, style, traits, model."""
    from ...personas import PERSONA_BY_SLUG

    resolved = []
    for item in discussion.personas:
        if isinstance(item, dict):
            slug = item.get('slug', '')
        else:
            slug = str(item)
        base = PERSONA_BY_SLUG.get(slug)
        if base is None:
            continue
        persona = dict(localize(base))
        persona['model'] = _default_model()
        persona['traits'] = []
        persona['temperature'] = DEFAULT_TEMPERATURE
        if isinstance(item, dict):
            if item.get('name'):
                persona['name'] = _text(item['name'], limit=64)
            # стиль і температуру API більше не приймає, але старі дискусії
            # їх зберігають — читаємо, щоб уточнення звучали як раніше
            if item.get('style'):
                persona['custom_style'] = _text(item['style'], limit=300)
            if item.get('traits'):
                persona['traits'] = _text_list(
                    item['traits'], limit=20, item_limit=40
                )
            if item.get('model'):
                persona['model'] = _text(item['model'], limit=120)
            if item.get('temperature') is not None:
                try:
                    value = float(item['temperature'])
                except (TypeError, ValueError):
                    value = DEFAULT_TEMPERATURE
                persona['temperature'] = max(0.0, min(1.0, value))
        resolved.append(persona)
    return resolved


def _model_for_persona(persona):
    return persona.get('model') or _default_model()


def _mode_ctx(discussion):
    return discussion.mode, list(discussion.options or [])


def _phase_start_seq(messages, phase):
    """Повідомлення фази рахуються від її останнього старту.

    Після уточнення користувача дискусія проходить синтез → Devil → відповіді
    вдруге, тож старі відповіді на Devil не мають зараховуватися новому колу.
    """
    if phase == Discussion.Phase.REBUTTAL:
        return max(
            (message.seq for message in messages if message.role == Message.Role.DEVIL),
            default=0,
        )
    return 0


def _speakers_done(messages, phase):
    start = _phase_start_seq(messages, phase)
    return {
        message.persona_slug
        for message in messages
        if message.role == Message.Role.AI and message.phase == phase and message.seq > start
    }
