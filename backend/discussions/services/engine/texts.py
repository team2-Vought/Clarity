"""Тексти суддів для чату: рішення модератора, перевірка AI Devil, фінальний висновок."""

from __future__ import annotations

from django.conf import settings

from backend.i18n import L

from ...models import Discussion, Message
from .. import prompts
from .base import STANCE_AGREE
from .parsing import _text, _text_list
from .context import _phase_start_seq


def _bullets(items):
    """Markdown-список: кожен пункт з нового рядка, без хвостових розділових знаків."""
    return '\n'.join(f'- {item.rstrip(" .;")}' for item in items if item.rstrip(' .;'))


def _section(title, body):
    return f'### {title}\n\n{body}' if body else ''


def _unbold(text):
    """Знімає **жирний** моделі з тексту, який ми й так обгортаємо в **…**."""
    return text.replace('**', '')


def _no_decision():
    return L('рішення не визначено', 'no solution was determined')


def _answer_line(value):
    """«**Відповідь: так**»: відповідь у тексті — мовою дискусії."""
    answer = _unbold(_text(value, limit=200))
    if not answer:
        return ''
    return L(f'**Відповідь: {answer}**', f'**Answer: {prompts.stance_label(answer)}**')


def _moderator_text(best_solution):
    best_solution = best_solution if isinstance(best_solution, dict) else {}
    decision = _text(best_solution.get('decision'), _no_decision(), limit=2000)
    reasoning = _text(best_solution.get('reasoning'), limit=4000)
    args = _bullets(_text_list(best_solution.get('supporting_arguments'), limit=4))
    dissent = _bullets(_text_list(best_solution.get('dissenting_points'), limit=4))
    parts = [_answer_line(best_solution.get('answer'))]
    parts.append(_section(L('Пропоноване рішення', 'Proposed solution'), decision))
    if reasoning:
        parts.append(reasoning)
    parts.append(_section(L('Аргументи на користь', 'Arguments in favour'), args))
    parts.append(_section(L('Що лишилось спірним', 'What remains disputed'), dissent))
    return '\n\n'.join(part for part in parts if part).strip()


def _devil_text(review):
    review = review if isinstance(review, dict) else {}
    parts = []
    verdict = _unbold(_text(review.get('verdict'), limit=1000))
    if verdict:
        parts.append(f'**{verdict.rstrip()}**')

    risks = []
    for risk in review.get('risks') or []:
        if not isinstance(risk, dict):
            continue
        title = _unbold(_text(risk.get('title'), limit=300)).rstrip(' .;')
        description = _text(risk.get('description'), limit=1000).rstrip(' .;')
        severity = _text(risk.get('severity'), limit=40)
        if not (title or description):
            continue
        line = f'**{title}** — {description}' if title and description else f'**{_unbold(title or description)}**'
        if severity:
            line += L(f' _(ризик: {severity})_', f' _(risk: {severity})_')
        risks.append(f'- {line}')
    if risks:
        parts.append(_section(L('Ризики', 'Risks'), '\n'.join(risks)))

    parts.append(_section(
        L('Слабкі місця', 'Weak spots'), _bullets(_text_list(review.get('weak_spots'), limit=3))
    ))
    parts.append(_section(
        L('Контраргументи', 'Counterarguments'),
        _bullets(_text_list(review.get('counter_arguments'), limit=3)),
    ))
    text = '\n\n'.join(part for part in parts if part).strip()
    return text or L('AI Devil не знайшов додаткових ризиків.', 'AI Devil found no additional risks.')


def _final_text(summary):
    summary = summary if isinstance(summary, dict) else {}
    parts = [_answer_line(summary.get('answer'))]

    headline = _text(summary.get('headline'), limit=200)
    if headline:
        parts.append(f'**{_unbold(headline)}**')
    decision = _text(summary.get('decision'), _no_decision(), limit=2000)
    parts.append(_section(L('Фінальне рішення', 'Final solution'), decision))
    parts.append(_section(
        L('За яких умов', 'Under which conditions'),
        _bullets(_text_list(summary.get('conditions'), limit=3)),
    ))

    if summary.get('confirmed') is False:
        revision = _text(summary.get('revision'), limit=2000)
        text = L(
            'Висновок **переглянуто** після перевірки AI Devil.',
            'The conclusion was **revised** after AI Devil’s review.',
        )
        if revision:
            text = f'{text} {L("Що змінилось", "What changed")}: {revision}'
        parts.append(text)
    elif summary.get('confirmed') is True:
        parts.append(L(
            'Висновок **підтверджено** після перевірки AI Devil.',
            'The conclusion was **confirmed** after AI Devil’s review.',
        ))

    agreement = summary.get('agreement') or {}
    if agreement.get('total'):
        agree, total = agreement.get('agree', 0), agreement['total']
        parts.append(L(
            f'Згода учасників: **{agree} з {total}**.',
            f'Participant agreement: **{agree} of {total}**.',
        ))

    risks = [
        f'{item.get("risk")} — {item.get("mitigation")}' if item.get('mitigation') else str(item.get('risk'))
        for item in summary.get('risk_plan') or []
        if isinstance(item, dict) and item.get('risk')
    ]
    parts.append(_section(L('Ризики і як їх зменшити', 'Risks and how to reduce them'), _bullets(risks)))
    unknowns = [
        f'{item.get("question")} — {item.get("how")}' if item.get('how') else str(item.get('question'))
        for item in summary.get('unknowns') or []
        if isinstance(item, dict) and item.get('question')
    ]
    parts.append(_section(L('Що з’ясувати', 'What to find out'), _bullets(unknowns)))
    parts.append(_section(L('План Б', 'Plan B'), _text(summary.get('plan_b'), limit=600)))
    parts.append(_section(
        L('Окремі думки', 'Dissenting opinions'),
        _bullets(_text_list(summary.get('dissenting_points'), limit=4)),
    ))
    steps = _text_list(summary.get('next_steps'), limit=5)
    if steps:
        parts.append(_section(
            L('План на тиждень', 'Plan for the week'),
            '\n'.join(f'{index}. {step}' for index, step in enumerate(steps, 1)),
        ))
    else:
        parts.append(_section(
            L('Що робити далі', 'What to do next'), _text(summary.get('recommendation'), limit=2000)
        ))
    parts.append(_section(
        L('Коли варто передумати', 'When to reconsider'),
        _bullets(_text_list(summary.get('change_triggers'), limit=4)),
    ))
    return '\n\n'.join(part for part in parts if part).strip()


def _merge_sources(discussion, found, added_by):
    """Додає знайдене до discussion.sources без дублікатів. Повертає нові id."""
    sources = list(discussion.sources or [])
    known = {source.get('url') for source in sources}
    limit = int(settings.SEARCH_MAX_SOURCES)
    added = []
    queries = 0
    for query, items in found or []:
        queries += 1
        for item in items:
            if len(sources) >= limit:
                break
            if item.get('url') in known:
                continue
            known.add(item['url'])
            source_id = len(sources) + 1
            sources.append({**item, 'id': source_id, 'query': query, 'added_by': added_by})
            added.append(source_id)
    discussion.sources = sources
    discussion.search_count = (discussion.search_count or 0) + queries
    return added


def _agreement(discussion, personas, answer):
    """Скільки учасників наприкінці підтримують висновок — за їхніми позиціями.

    `votes` — остання позиція кожного учасника: з неї підсумок малює, хто за що.
    """
    messages = list(discussion.messages.order_by('seq'))
    devil_seq = _phase_start_seq(messages, Discussion.Phase.REBUTTAL)
    agree = disagree = unknown = 0
    votes = []
    for persona in personas:
        mine = [
            m for m in messages
            if m.role == Message.Role.AI and m.persona_slug == persona['slug'] and m.stance
        ]
        after_devil = [m for m in mine if m.seq > devil_seq]
        stance = (after_devil or mine)[-1].stance if (after_devil or mine) else ''
        votes.append({'name': persona.get('name') or '', 'stance': stance or ''})
        if not stance:
            unknown += 1
        elif discussion.mode == Discussion.Mode.OPEN:
            if stance == STANCE_AGREE:
                agree += 1
            else:
                disagree += 1
        elif answer:
            if stance.casefold() == str(answer).casefold():
                agree += 1
            else:
                disagree += 1
        else:
            unknown += 1
    return {
        'agree': agree,
        'disagree': disagree,
        'unknown': unknown,
        'total': len(personas),
        'votes': votes,
    }
