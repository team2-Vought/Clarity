"""Дерево рішень після дискусії: які шляхи були на столі, куди кожен веде
і як команда дійшла до висновку.

Будується на вимогу людини одним JSON-викликом модератора й зберігається в
`Discussion.decision_tree`. Новий висновок (уточнення після фіналу) скидає
дерево — воно завжди пояснює той висновок, який людина бачить зараз.
"""

from __future__ import annotations

import re

from django.utils import timezone

from backend.i18n import L, using

from ...models import Discussion, Message
from ...personas import PERSONA_BY_SLUG, devil, localize, moderator
from ..attachments import documents_for_prompt
from .. import prompts
from .base import EngineConflict, EngineError
from .calls import _run_json_plan
from .context import _is_available, _list_messages, _mode_ctx, _resolved_personas
from .parsing import _confidence, _plain, _text, _text_list
from .planning import _judge_plan

STATUSES = ('chosen', 'alternative', 'rejected')
TONES = ('good', 'neutral', 'bad')
STAGES = ('question', 'debate', 'turn', 'devil', 'conclusion')

TITLE_LIMIT = 80
SUMMARY_LIMIT = 300
WHY_LIMIT = 400
POINT_LIMIT = 160
POINTS = 3
# менше кроків — це вже не хід думок, а переказ висновку
TREE_MIN_STEPS = 3


def _fold(value):
    return str(value or '').casefold().strip(' .,!?:;«»"“”\'*_')


# «то …» / «then …» на початку наслідку: стрілку перед ним і так малює інтерфейс
_THEN_RE = re.compile(r'^\s*(?:→|->|то|тоді|then)\s*[:,—–-]?\s+', re.IGNORECASE)


def _cap(text):
    """Перша літера — велика: модель часто пише пункти з малої."""
    return text[:1].upper() + text[1:] if text else text


def _plain_cap(value, limit):
    return _cap(_plain(value, limit))


def _short(text, limit):
    """Довгий заголовок — до межі слова з «…», а не обрізаний посеред слова."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(' ', 1)[0].rstrip(' ,;:—–-')
    return f'{cut or text[: limit - 1]}…'


def tree_problems(data, mode, options):
    """Що не так із JSON дерева — для повторного запиту на виправлення."""
    if not isinstance(data, dict):
        return [L('відповідь не є JSON-об’єктом', 'the reply is not a JSON object')]
    branches = [item for item in data.get('branches') or [] if isinstance(item, dict) and item.get('title')]
    problems = []
    if len(branches) < prompts.TREE_MIN_BRANCHES:
        problems.append(L(
            f'у "branches" має бути щонайменше {prompts.TREE_MIN_BRANCHES} гілки з title',
            f'"branches" must contain at least {prompts.TREE_MIN_BRANCHES} branches with a title',
        ))
    if not any(_fold(item.get('status')) == 'chosen' for item in branches):
        problems.append(L(
            'рівно одна гілка має мати status "chosen"',
            'exactly one branch must have status "chosen"',
        ))
    steps = [item for item in data.get('path') or [] if isinstance(item, dict) and item.get('title')]
    if len(steps) < TREE_MIN_STEPS:
        problems.append(L(
            f'у "path" має бути щонайменше {TREE_MIN_STEPS} кроки ходу думок — від питання до висновку',
            f'"path" must contain at least {TREE_MIN_STEPS} steps of the train of thought — '
            'from the question to the conclusion',
        ))
    return problems


def _people(personas):
    """Ім'я (у будь-якому регістрі) → хто це, для кольору й аватарки на схемі."""
    people = {}
    for persona in [*personas, moderator(), devil()]:
        person = {
            'slug': persona.get('slug', ''),
            'name': persona.get('name', ''),
            'color': persona.get('color', ''),
            'avatar': persona.get('avatar', ''),
        }
        # ім'я, яке дала людина, slug і назва ролі («Логік») — модель могла взяти будь-яке
        base = PERSONA_BY_SLUG.get(persona.get('slug'))
        role = localize(base).get('name') if base else ''
        for key in (persona.get('name'), persona.get('slug'), role):
            if key and _fold(key) not in people:
                people[_fold(key)] = person
    # модель могла написати «Модератор» англійською чи навпаки
    people.setdefault('moderator', people.get(_fold(moderator()['name'])))
    people.setdefault('модератор', people.get(_fold(moderator()['name'])))
    return people


def _person(name, people):
    found = people.get(_fold(name))
    if found:
        return dict(found)
    text = _plain(name, 64)
    return {'slug': '', 'name': text, 'color': '', 'avatar': ''} if text else None


def _outcomes(value):
    result = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        condition = _plain_cap(item.get('condition'), 200)
        outcome = _cap(_THEN_RE.sub('', _plain(item.get('result'), SUMMARY_LIMIT)))
        if not (condition or outcome):
            continue
        tone = _fold(item.get('tone'))
        result.append({
            'id': '',
            'condition': condition,
            'result': outcome,
            'tone': tone if tone in TONES else 'neutral',
        })
        if len(result) >= prompts.TREE_MAX_OUTCOMES:
            break
    return result


def _branch(item, people):
    status = _fold(item.get('status'))
    supporters = []
    for name in _text_list(item.get('supporters'), limit=6, item_limit=64):
        person = _person(name, people)
        if person and person['name'] not in {p['name'] for p in supporters}:
            supporters.append(person)
    return {
        'id': '',
        'title': _plain_cap(item.get('title'), TITLE_LIMIT),
        'status': status if status in STATUSES else 'alternative',
        'summary': _plain_cap(item.get('summary'), SUMMARY_LIMIT),
        'fit': _confidence(item.get('fit')),
        'supporters': supporters,
        'pros': [_plain_cap(point, POINT_LIMIT) for point in _text_list(item.get('pros'), limit=POINTS)],
        'cons': [_plain_cap(point, POINT_LIMIT) for point in _text_list(item.get('cons'), limit=POINTS)],
        'why': _plain_cap(item.get('why'), WHY_LIMIT),
        'outcomes': _outcomes(item.get('outcomes')),
    }


def _matches_answer(branch, answer, mode):
    """Чи гілка — це відповідь висновку («так» / «ні» / варіант)."""
    if not answer:
        return False
    title = _fold(branch['title'])
    target = _fold(answer)
    if mode == Discussion.Mode.YES_NO:
        labels = {_fold(answer), _fold(prompts.stance_label(answer))}
        return any(title == label or title.startswith(f'{label} ') or title.startswith(f'{label},') for label in labels)
    return title == target


def _pick_chosen(branches, answer, mode):
    """Рівно одна обрана гілка: та, що збігається з відповіддю висновку,
    інакше перша позначена моделлю, інакше найпридатніша."""
    by_answer = [b for b in branches if _matches_answer(b, answer, mode)]
    marked = [b for b in branches if b['status'] == 'chosen']
    if by_answer:
        chosen = by_answer[0]
    elif marked:
        chosen = max(marked, key=lambda b: b['fit'] or 0)
    else:
        chosen = max(branches, key=lambda b: b['fit'] or 0)
    for branch in branches:
        if branch is chosen:
            branch['status'] = 'chosen'
        elif branch['status'] == 'chosen':
            branch['status'] = 'alternative'
    return chosen


def _options_branches(branches, options):
    """«Один із варіантів»: назви гілок — дослівно варіанти людини, і жоден не губиться."""
    by_option = {}
    for branch in branches:
        for option in options:
            if _fold(branch['title']) == _fold(option) and option not in by_option:
                branch['title'] = option
                by_option[option] = branch
                break
    result = []
    for option in options:
        result.append(by_option.get(option) or {
            'id': '',
            'title': option,
            'status': 'alternative',
            'summary': '',
            'fit': None,
            'supporters': [],
            'pros': [],
            'cons': [],
            'why': '',
            'outcomes': [],
        })
    return result


# назви етапів обома мовами: заголовок кроку, що лише їх повторює, нічого не каже
_STAGE_NAMES = {
    'питання', 'запитання', 'question', 'дискусія', 'обговорення', 'discussion', 'debate',
    'перелом', 'переломний момент', 'переломний аргумент', 'turning point', 'turn',
    'ai devil', 'devil', 'висновок', 'conclusion',
}


def _path(value, people):
    steps = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        title = _plain_cap(item.get('title'), WHY_LIMIT)
        text = _plain_cap(item.get('text'), WHY_LIMIT)
        if _fold(title) in _STAGE_NAMES and text:
            # «Обговорення» — не заголовок: беремо суть з тексту
            title, text = text, ''
        if _fold(text) == _fold(title):
            text = ''
        if len(title) > TITLE_LIMIT:
            # задовгий заголовок: коротка версія вгорі, повна — текстом під нею
            title, text = _short(title, TITLE_LIMIT), text or title
        if not (title or text):
            continue
        stage = _fold(item.get('stage'))
        # лише справжні учасники, модератор чи Devil — «Учасники» чи «Користувач» не автори
        who = people.get(_fold(item.get('who'))) if item.get('who') else None
        steps.append({
            'stage': stage if stage in STAGES else 'debate',
            'title': title or text[:TITLE_LIMIT],
            'text': text if title else '',
            'who': dict(who) if who else None,
        })
        if len(steps) >= prompts.TREE_MAX_STEPS:
            break
    return steps


STAGE_RANK = {stage: index for index, stage in enumerate(('question', 'debate', 'turn', 'devil', 'conclusion'))}


def _fallback_path(discussion, people, root):
    """Хід думок із самої дискусії — на випадок, коли модель дала один-два кроки."""
    steps = [{'stage': 'question', 'title': _short(root, TITLE_LIMIT), 'text': '', 'who': None}]
    latest = {}
    if discussion.pk:
        for slug, stance in (
            discussion.messages.filter(role=Message.Role.AI)
            .exclude(stance='')
            .order_by('seq')
            .values_list('persona_slug', 'stance')
        ):
            latest[slug] = stance
    if latest:
        parts = []
        for slug, stance in latest.items():
            person = people.get(_fold(slug))
            parts.append(f"{person['name'] if person else slug}: {prompts.stance_label(stance)}")
        steps.append({
            'stage': 'debate',
            'title': L('Позиції учасників', 'Where the participants stood'),
            'text': ' · '.join(parts)[:WHY_LIMIT],
            'who': None,
        })
    verdict = _plain_cap((discussion.devil_review or {}).get('verdict'), WHY_LIMIT)
    if verdict:
        steps.append({
            'stage': 'devil',
            'title': L('Перевірка AI Devil', 'AI Devil’s check'),
            'text': verdict,
            'who': dict(people[_fold(devil()['name'])]),
        })
    decision = _plain_cap((discussion.final_summary or {}).get('decision'), WHY_LIMIT)
    if decision:
        short = _short(decision, TITLE_LIMIT)
        steps.append({
            'stage': 'conclusion',
            'title': short,
            'text': decision if short != decision else '',
            'who': dict(people[_fold(moderator()['name'])]),
        })
    return steps


def _complete_path(steps, discussion, people, root):
    """Доповнює короткий хід думок етапами, яких бракує, у природному порядку."""
    if len(steps) >= TREE_MIN_STEPS:
        return steps
    have = {step['stage'] for step in steps}
    extra = [step for step in _fallback_path(discussion, people, root) if step['stage'] not in have]
    merged = steps + extra
    merged.sort(key=lambda step: STAGE_RANK.get(step['stage'], 1))
    return merged[: prompts.TREE_MAX_STEPS]


def normalize_tree(data, discussion, personas):
    data = data if isinstance(data, dict) else {}
    mode, options = _mode_ctx(discussion)
    summary = discussion.final_summary or {}
    people = _people(personas)

    branches = [
        _branch(item, people)
        for item in data.get('branches') or []
        if isinstance(item, dict) and _plain(item.get('title'), TITLE_LIMIT)
    ][: prompts.TREE_MAX_BRANCHES]
    if mode == Discussion.Mode.CHOOSE_ONE and options:
        branches = _options_branches(branches, options)
    if len(branches) < prompts.TREE_MIN_BRANCHES:
        raise EngineError(
            'Модель не побудувала дерево рішень.',
            code='empty_response',
            public=L(
                'Модель не змогла побудувати дерево рішень. Спробуйте ще раз.',
                'The model could not build the decision tree. Please try again.',
            ),
        )
    _pick_chosen(branches, summary.get('answer'), mode)
    for index, branch in enumerate(branches, start=1):
        branch['id'] = f'b{index}'
        for number, outcome in enumerate(branch['outcomes'], start=1):
            outcome['id'] = f'b{index}o{number}'

    first_line = (discussion.question or '').strip().splitlines()[0] if discussion.question else ''
    root = _plain(data.get('root'), 140) or _text(first_line, limit=140)
    return {
        'root': root,
        'mode': mode,
        'answer': summary.get('answer') or '',
        'confidence': summary.get('confidence'),
        'branches': branches,
        'path': _complete_path(_path(data.get('path'), people), discussion, people, root),
    }


def build_tree(discussion, provider_factory=None):
    """Будує й зберігає дерево рішень. Мовою, якою створено дискусію."""
    with using(discussion.language):
        return _build(discussion, provider_factory)


def _build(discussion, provider_factory):
    if discussion.phase != Discussion.Phase.DONE or not discussion.final_summary:
        raise EngineError(
            'Дискусія ще без висновку.',
            code='not_ready',
            public=L(
                'Дерево рішень з’явиться, коли дискусія дійде висновку.',
                'The decision tree appears once the discussion reaches a conclusion.',
            ),
            retryable=False,
        )
    personas = _resolved_personas(discussion)
    mode, options = _mode_ctx(discussion)
    question = prompts.question_with_clarifications(discussion.question, discussion.clarifications)
    plan = _judge_plan(
        discussion,
        personas,
        'moderator',
        phase=Discussion.Phase.FINAL,
        role=Message.Role.MODERATOR,
        persona=moderator(),
        system=prompts.moderator_system(),
        prompt=prompts.tree_prompt(
            question,
            personas,
            _list_messages(discussion),
            discussion.final_summary,
            discussion.devil_review,
            mode=mode,
            options=options,
            rounds=discussion.rounds,
            consensus=discussion.until_consensus,
            sources=discussion.sources if discussion.web_search else None,
            profile=discussion.profile,
            documents=documents_for_prompt(discussion.attachments.all()),
            matrix=discussion.matrix,
        ),
        json_kind='tree',
        check=tree_problems,
    )
    # першою — модель, що щойно написала висновок: вона точно відповідає, а судді
    # за замовчуванням могли бути перевантажені (503 і довгі повтори)
    concluded = (
        discussion.messages.filter(
            role=Message.Role.MODERATOR,
            phase__in=[Discussion.Phase.FINAL, Discussion.Phase.QUICK],
        )
        .exclude(model_id='')
        .order_by('-seq')
        .values_list('model_id', flat=True)
        .first()
    )
    if concluded and concluded != plan.model_id and _is_available(concluded):
        plan.fallback_models = [plan.model_id, *[m for m in plan.fallback_models if m != concluded]]
        plan.model_id = concluded
    _, data = _run_json_plan(plan, provider_factory, discussion)
    tree = normalize_tree(data, discussion, personas)
    tree['built_at'] = timezone.now().isoformat()

    # поки модель думала, людина могла поставити уточнення — тоді висновок уже інший
    summary = discussion.final_summary
    current = Discussion.objects.filter(pk=discussion.pk).values_list('final_summary', 'phase').first()
    if current is None or current[0] != summary or current[1] != Discussion.Phase.DONE:
        raise EngineConflict('Висновок змінився, поки будувалося дерево.', code='conflict')
    # лише своя побудова: новий висновок чи новіший запуск уже скинули tree_started_at
    Discussion.objects.filter(pk=discussion.pk, tree_started_at=discussion.tree_started_at).update(
        decision_tree=tree, tree_state='', tree_error='', tree_started_at=None, tree_heartbeat_at=None
    )
    discussion.decision_tree = tree
    return tree
