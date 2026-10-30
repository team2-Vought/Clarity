"""Розбір і нормалізація відповідей моделей: JSON суддів і службові рядки реплік."""

from __future__ import annotations

import json
import re

from backend.i18n import L

from ...models import Discussion
from .. import prompts, search
from .base import STANCE_AGREE, STANCE_DISPUTE


# англійські промпти просять THESIS/STANCE/SEARCH — розбираємо обидва варіанти
_SERVICE_LINE_RE = re.compile(
    r'^[ \t>*_#\-]*(ТЕЗА|ПОЗИЦІЯ|ПОШУК|THESIS|STANCE|SEARCH)[ \t*_]*:[ \t*_]*(.*?)[ \t*_]*$',
    re.IGNORECASE | re.MULTILINE,
)
_SERVICE_KEYS = {'thesis': 'теза', 'stance': 'позиція', 'search': 'пошук'}

_JSON_FENCE_RE = re.compile(
    r'```(?:json)?\s*(.*?)\s*```',
    re.IGNORECASE | re.DOTALL,
)


def _strip_code_fences(raw):
    text = str(raw or '').strip()
    matches = _JSON_FENCE_RE.findall(text)
    if matches:
        return matches[0].strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE)
        text = re.sub(r'\s*```$', '', text)
    return text.strip()


def _extract_json(raw):
    """Витягує перший JSON-об'єкт навіть із тексту навколо нього."""
    if not isinstance(raw, str) or not raw.strip():
        return None

    candidates = [raw.strip(), _strip_code_fences(raw)]
    decoder = json.JSONDecoder()
    for candidate in candidates:
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass

        for index, char in enumerate(candidate):
            if char != '{':
                continue
            try:
                data, _ = decoder.raw_decode(candidate[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(data, dict):
                return data
    return None


def parse_json(raw, fallback=None):
    """Сумісний із попереднім API парсер: повертає dict або fallback."""
    return _extract_json(raw) or fallback


def _text(value, default='', limit=4000):
    if value is None:
        return default
    if isinstance(value, bool):
        return default
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    text = str(value).strip()
    return text[:limit] if text else default


def _text_list(value, *, limit=8, item_limit=1200):
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        return []
    result = []
    for item in value:
        text = _text(item, limit=item_limit)
        if text and text not in result:
            result.append(text)
        if len(result) >= limit:
            break
    return result


def _answer(value, mode, options):
    if value is None:
        return None
    text = _text(value, limit=200)
    if not text:
        return None
    if mode == Discussion.Mode.YES_NO:
        # модель може виділити відповідь **жирним**, хоча її просили без розмітки
        normalized = text.casefold().strip(' .,!?:;«»"\'*_')
        if normalized in {'так', 'yes', 'true', 'позитивно', 'згоден', 'згодна'}:
            return 'так'
        if normalized in {'ні', 'no', 'false', 'негативно', 'не згоден', 'не згодна'}:
            return 'ні'
        return None
    if mode == Discussion.Mode.CHOOSE_ONE:
        folded = text.casefold().strip(' .,!?:;«»"\'*_')
        for option in options or []:
            if folded == str(option).casefold():
                return str(option)
        return None
    return text


def _as_bool(value, default=None):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in {0, 1}:
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().casefold()
        if normalized in {'true', '1', 'yes', 'так', 'підтверджено'}:
            return True
        if normalized in {'false', '0', 'no', 'ні', 'не підтверджено'}:
            return False
    return default


def _confidence(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return max(0, min(100, number))


def _queries(value, limit):
    result = []
    for item in _text_list(value, limit=limit * 2, item_limit=300):
        query = search.normalize_query(item)
        if query and query.casefold() not in {q.casefold() for q in result}:
            result.append(query)
        if len(result) >= limit:
            break
    return result


def _derive_answer(text, mode, options):
    """Відповідь із вільного тексту рішення, якщо модель не заповнила answer."""
    if mode == Discussion.Mode.OPEN or not text:
        return None
    return _answer(text, mode, options) or _normalize_stance(text, mode, options) or None


def normalize_solution(data, mode, options, fallback_answer=''):
    data = data if isinstance(data, dict) else {}
    decision = _text(data.get('decision'), L('Рішення не сформовано', 'No solution was formed'), limit=2000)
    result = {
        'decision': decision,
        'reasoning': _text(data.get('reasoning'), limit=4000),
        'supporting_arguments': _text_list(data.get('supporting_arguments')),
        'dissenting_points': _text_list(data.get('dissenting_points')),
    }
    answer = (
        _answer(data.get('answer'), mode, options)
        or _derive_answer(decision, mode, options)
        or (fallback_answer if mode != Discussion.Mode.OPEN else None)
    )
    if answer:
        result['answer'] = answer
    return result


def normalize_review(data):
    data = data if isinstance(data, dict) else {}
    risks = []
    for item in data.get('risks') or []:
        if isinstance(item, dict):
            title = _text(item.get('title'), limit=300)
            description = _text(item.get('description'), limit=1000)
            severity = _text(item.get('severity'), limit=40)
            if title or description:
                risks.append(
                    {
                        'title': title or description,
                        'description': description,
                        'severity': severity,
                    }
                )
        else:
            text = _text(item, limit=1000)
            if text:
                risks.append({'title': text, 'description': '', 'severity': ''})
        if len(risks) >= 8:
            break
    return {
        'verdict': _text(data.get('verdict'), limit=1000),
        'risks': risks,
        'weak_spots': _text_list(data.get('weak_spots')),
        'counter_arguments': _text_list(data.get('counter_arguments')),
    }


def normalize_summary(data, best_solution, mode, options):
    data = data if isinstance(data, dict) else {}
    best_solution = best_solution if isinstance(best_solution, dict) else {}
    decision = _text(data.get('decision'), best_solution.get('decision', ''), limit=2000)
    result = {
        'decision': decision,
        'confirmed': _as_bool(data.get('confirmed'), None),
        'revision': _text(data.get('revision'), limit=2000),
        'pros': _text_list(data.get('pros')),
        'cons': _text_list(data.get('cons')),
        'risks': _text_list(data.get('risks')),
        'dissenting_points': (
            _text_list(data.get('dissenting_points'))
            or _text_list(best_solution.get('dissenting_points'))
        ),
        'confidence': _confidence(data.get('confidence')),
        'recommendation': _text(data.get('recommendation'), limit=2000),
    }
    best_answer = _answer(best_solution.get('answer'), mode, options)
    answer = (
        _answer(data.get('answer'), mode, options)
        or _derive_answer(decision, mode, options)
        or best_answer
    )
    if answer and mode != Discussion.Mode.OPEN:
        result['answer'] = answer
        if best_answer and answer != best_answer:
            # Відповідь змінилась — це перегляд, навіть якщо модель написала інакше.
            result['confirmed'] = False
            if not result['revision']:
                result['revision'] = L(
                    f'Відповідь змінено з «{best_answer}» на «{answer}» '
                    'після перевірки AI Devil.',
                    f'The answer changed from “{prompts.stance_label(best_answer)}” to '
                    f'“{prompts.stance_label(answer)}” after AI Devil’s review.',
                )
        elif result['confirmed'] is None and best_answer:
            result['confirmed'] = True
    elif answer:
        result['answer'] = answer
    if result['confirmed'] is True:
        result['revision'] = ''
    return result


_EMPHASIS_RE = re.compile(r'\*{1,2}|(?<!\w)_{1,2}|_{1,2}(?!\w)')


def _plain(value, limit):
    """Питання й варіанти показуються як звичайний текст: прибираємо **жирний** і *курсив*."""
    return _text(_EMPHASIS_RE.sub('', str(value or '')), limit=limit)


def normalize_clarify(data):
    """{ready, questions: [{id, question, options}]}; без запитань — готово."""
    data = data if isinstance(data, dict) else {}
    questions = []
    raw = data.get('questions') if isinstance(data.get('questions'), list) else []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = _plain(item.get('question'), 300)
        options = item.get('options') if isinstance(item.get('options'), list) else []
        variants = []
        for option in options:
            option = _plain(option, 100)
            if option and option.casefold() not in {variant.casefold() for variant in variants}:
                variants.append(option)
            if len(variants) >= prompts.CLARIFY_MAX_OPTIONS:
                break
        if text and len(variants) >= 2:
            questions.append({'id': f'q{len(questions) + 1}', 'question': text, 'options': variants})
        if len(questions) >= prompts.CLARIFY_MAX_QUESTIONS:
            break
    ready = _as_bool(data.get('ready'), True) or not questions
    return {'ready': ready, 'questions': [] if ready else questions}


def _answer_problems(data, mode, options):
    if mode == Discussion.Mode.OPEN or _answer(data.get('answer'), mode, options):
        return []
    if mode == Discussion.Mode.YES_NO:
        return [L('поле "answer" має бути рівно "так" або "ні"', 'the "answer" field must be exactly "yes" or "no"')]
    variants = '; '.join(str(option) for option in options or [])
    return [L(
        f'поле "answer" має дослівно збігатися з одним із варіантів: {variants}',
        f'the "answer" field must match one of the options word for word: {variants}',
    )]


def _not_json():
    return L('відповідь не є JSON-об’єктом', 'the reply is not a JSON object')


def _empty_decision():
    return L('поле "decision" порожнє', 'the "decision" field is empty')


def _solution_problems(data, mode, options):
    if not isinstance(data, dict):
        return [_not_json()]
    problems = [] if _text(data.get('decision')) else [_empty_decision()]
    return problems + _answer_problems(data, mode, options)


def _review_problems(data, mode, options):
    if not isinstance(data, dict):
        return [_not_json()]
    if _text(data.get('verdict')) or data.get('risks'):
        return []
    return [L(
        'потрібні поле "verdict" або непорожній список "risks"',
        'a "verdict" field or a non-empty "risks" list is required',
    )]


def _summary_problems(data, mode, options):
    if not isinstance(data, dict):
        return [_not_json()]
    problems = [] if _text(data.get('decision')) else [_empty_decision()]
    if _as_bool(data.get('confirmed'), None) is None:
        problems.append(L('поле "confirmed" має бути true або false', 'the "confirmed" field must be true or false'))
    return problems + _answer_problems(data, mode, options)


def _clarify_problems(data, mode, options):
    if not isinstance(data, dict):
        return [_not_json()]
    ready = _as_bool(data.get('ready'), None)
    if ready is None:
        return [L('поле "ready" має бути true або false', 'the "ready" field must be true or false')]
    if not ready and not normalize_clarify(data)['questions']:
        return [L(
            'при ready: false потрібні запитання з 2+ варіантами відповіді',
            'ready: false requires questions with 2+ answer options',
        )]
    return []


PROBLEM_CHECKS = {
    'clarify': _clarify_problems,
    'solution': _solution_problems,
    'review': _review_problems,
    'summary': _summary_problems,
}


def _normalize_stance(value, mode, options):
    text = _text(value, limit=200).strip(' .,!?:;«»"\'*_')
    if not text:
        return ''
    if mode == Discussion.Mode.YES_NO:
        words = text.split()
        return _answer(words[0], mode, options) or _answer(text, mode, options) or ''
    if mode == Discussion.Mode.CHOOSE_ONE:
        exact = _answer(text, mode, options)
        if exact:
            return exact
        folded = text.casefold()
        matches = sorted(
            (str(option) for option in options or [] if str(option).casefold() in folded),
            key=len,
            reverse=True,
        )
        # «Так» і «Так, але пізніше» — вкладені варіанти, беремо довший;
        # два різні варіанти в одній позиції — неоднозначність.
        if matches and all(item.casefold() in matches[0].casefold() for item in matches):
            return matches[0]
        return ''
    folded = text.casefold()
    if folded.startswith(('незгод', 'не згод', 'супереч', 'disagree', 'dispute', 'disput')):
        return STANCE_DISPUTE
    if folded.startswith(('згод', 'agree')):
        return STANCE_AGREE
    return ''


def parse_reply(raw, mode, options):
    """Відокремлює службові рядки ТЕЗА/ПОЗИЦІЯ/ПОШУК від тексту репліки.

    Службові рядки стоять наприкінці, тож для кожного ключа береться останній
    збіг і вирізається лише він: рядок «Позиція: …» усередині тексту
    залишається частиною репліки.
    """
    text = str(raw or '').replace('\r\n', '\n')
    last = {}
    for match in _SERVICE_LINE_RE.finditer(text):
        key = match.group(1).casefold()
        last[_SERVICE_KEYS.get(key, key)] = match
    thesis = _text(last['теза'].group(2), limit=300) if 'теза' in last else ''
    stance = (
        _normalize_stance(last['позиція'].group(2), mode, options)
        if 'позиція' in last
        else ''
    )
    query = search.normalize_query(last['пошук'].group(2)) if 'пошук' in last else ''

    content = text
    for match in sorted(last.values(), key=lambda item: item.start(), reverse=True):
        content = content[: match.start()] + content[match.end():]
    content = re.sub(r'\n{3,}', '\n\n', content).strip() or text.strip()
    if not thesis:
        thesis = prompts.fallback_thesis(content)
    return {
        'content': content,
        'thesis': thesis[:300],
        'stance': stance[:100],
        'search_query': query,
    }
