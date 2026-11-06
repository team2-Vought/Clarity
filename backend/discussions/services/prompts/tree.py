"""Промпт дерева рішень: після дискусії модератор розкладає, які шляхи були
на столі, куди кожен веде і як команда дійшла до висновку."""

import json

from backend.i18n import L

from .context import _context_block
from .criteria import matrix_block

# скільки гілок і наслідків просимо — більше на схемі вже не читається
TREE_MIN_BRANCHES = 2
TREE_MAX_BRANCHES = 4
TREE_MAX_OUTCOMES = 3
TREE_MAX_STEPS = 6


def _branches_rule(mode, options):
    if mode == 'yes_no':
        return L(
            'Гілки — це «так» і «ні» (можна додати третю, якщо в дискусії звучав '
            'компроміс на кшталт «так, але пізніше»). ',
            'The branches are “yes” and “no” (you may add a third one if a '
            'compromise like “yes, but later” came up in the discussion). ',
        )
    if mode == 'choose_one':
        variants = '; '.join(options or [])
        return L(
            f'Гілки — це варіанти користувача ({variants}), по одній на кожен, '
            'з назвами дослівно як у списку. ',
            f'The branches are the user’s options ({variants}), one per option, '
            'named word for word as in the list. ',
        )
    return L(
        f'Гілки — {TREE_MIN_BRANCHES}–{TREE_MAX_BRANCHES} справді різні шляхи, які '
        'звучали в дискусії або напрошуються з неї: обраний висновок і реальні '
        'альтернативи (зокрема «нічого не міняти», якщо це чесний варіант). Не '
        'роби гілки з дрібних варіацій одного й того самого. ',
        f'The branches are {TREE_MIN_BRANCHES}–{TREE_MAX_BRANCHES} genuinely different '
        'paths that came up in the discussion or follow from it: the chosen '
        'conclusion and real alternatives (including “change nothing” if that is an '
        'honest option). Do not make branches out of small variations of the same thing. ',
    )


def tree_prompt(
    question,
    personas,
    messages,
    final_summary,
    devil_review=None,
    mode='open',
    options=None,
    rounds=2,
    consensus=False,
    sources=None,
    profile=None,
    documents=None,
    matrix=None,
):
    ctx = _context_block(
        question, personas, messages, mode, options or [], rounds,
        sources=sources,
        profile=profile,
        documents=documents,
        consensus=consensus,
    )
    if matrix_block(matrix):
        ctx = f'{ctx}\n\n{matrix_block(matrix)}'
    # лише суть висновку й критики: повний JSON зайвий і плутав би схему відповіді
    summary = final_summary or {}
    conclusion = {
        'answer': summary.get('answer', ''),
        'decision': summary.get('decision', ''),
        'confidence': summary.get('confidence'),
        'dissent': summary.get('dissenting_points', []),
    }
    review = devil_review or {}
    criticism = {'risks': [risk.get('title', '') for risk in review.get('risks') or []]}
    head = L(
        f'Фінальний висновок дискусії: {json.dumps(conclusion, ensure_ascii=False)}\n'
        f'Головні закиди AI Devil: {json.dumps(criticism, ensure_ascii=False)}\n\n',
        f'The final conclusion of the discussion: {json.dumps(conclusion, ensure_ascii=False)}\n'
        f'AI Devil’s main objections: {json.dumps(criticism, ensure_ascii=False)}\n\n',
    )
    task = L(
        'Побудуй для користувача дерево рішень за цією дискусією — так, щоб він '
        'одним поглядом побачив, які шляхи в нього є, куди кожен веде і чому '
        'команда обрала саме цей. '
        + _branches_rule(mode, options)
        + 'Рівно одна гілка має status "chosen" — та, що відповідає фінальному '
        'висновку; решта — "alternative" (варте уваги, але програло) або '
        '"rejected" (команда свідомо відкинула через серйозну ваду). '
        'fit — наскільки гілка пасує саме цій людині з її обставинами (0–100); '
        'у обраної він найвищий. '
        'supporters — імена учасників (як у списку учасників), які стояли за '
        'цією гілкою; порожньо, якщо таких не було. '
        'why — одне-два речення: чому гілку обрали чи чому вона програла, з '
        'посиланням на вирішальний аргумент. '
        f'outcomes — 1–{TREE_MAX_OUTCOMES} розвилки всередині гілки: за якої умови '
        '(condition, починається з «Якщо…») до чого це приведе (result — сам наслідок, '
        'без «то»). tone: "good", '
        '"neutral" чи "bad". Умови мають бути конкретні й перевірювані для цієї '
        'людини, а не «якщо все піде добре». '
        f'path — хід думок команди, 3–{TREE_MAX_STEPS} кроків від питання до '
        'висновку: що з’ясували, де розійшлися, що переконало, що змінив Devil. '
        'stage: "question", "debate", "turn" (переломний момент), "devil" або '
        '"conclusion"; who — хто це сказав (ім’я учасника, «AI Devil», '
        '«Модератор» або порожньо). '
        'Пиши коротко, з великої літери: title гілки — до 6 слів, summary — одне речення, '
        'pros і cons — до 3 пунктів по кілька слів. Опирайся лише на те, що є '
        'в дискусії, нічого не вигадуй. ',
        'Build a decision tree from this discussion for the user — so that at a '
        'glance they can see what paths they have, where each one leads and why '
        'the team chose this one. '
        + _branches_rule(mode, options)
        + 'Exactly one branch has status "chosen" — the one that matches the final '
        'conclusion; the rest are "alternative" (worth considering but lost) or '
        '"rejected" (the team consciously discarded it because of a serious flaw). '
        'fit — how well the branch suits this particular person in their '
        'circumstances (0–100); the chosen one has the highest. '
        'supporters — the names of participants (as in the participant list) who '
        'backed this branch; empty if there were none. '
        'why — one or two sentences: why the branch was chosen or why it lost, '
        'pointing to the decisive argument. '
        f'outcomes — 1–{TREE_MAX_OUTCOMES} forks inside the branch: under what '
        'condition (condition, starting with “If…”) it leads to what (result — the '
        'consequence itself, without “then”). tone: "good", '
        '"neutral" or "bad". Conditions must be concrete and checkable for this '
        'person, not “if all goes well”. '
        f'path — the team’s train of thought, 3–{TREE_MAX_STEPS} steps from the '
        'question to the conclusion: what they found out, where they disagreed, '
        'what convinced them, what Devil changed. stage: "question", "debate", '
        '"turn" (a turning point), "devil" or "conclusion"; title — the gist of the '
        'step in a few words, not the stage name; who — who said it (a participant’s '
        'name, “AI Devil”, “Moderator”, or empty if it was none of them). '
        'Keep it short and start each item with a capital letter: a branch title — up to 6 words, summary — one sentence, '
        'pros and cons — up to 3 items of a few words. Rely only on what is in the '
        'discussion, invent nothing. ',
    )
    schema = L(
        'Відповідай СУВОРО одним JSON-об’єктом:\n'
        '{"root": "питання людини одним коротким рядком", '
        '"branches": [{"title": "назва шляху", "status": "chosen | alternative | rejected", '
        '"summary": "суть одним реченням", "fit": 0-100, "supporters": ["ім’я"], '
        '"pros": ["плюс"], "cons": ["мінус"], "why": "чому обрали чи відкинули", '
        '"outcomes": [{"condition": "якщо…", "result": "то…", "tone": "good | neutral | bad"}]}], '
        '"path": [{"stage": "question | debate | turn | devil | conclusion", '
        '"title": "коротко", "text": "одне-два речення", "who": "хто"}]}',
        'Reply STRICTLY with a single JSON object:\n'
        '{"root": "the person’s question in one short line", '
        '"branches": [{"title": "path name", "status": "chosen | alternative | rejected", '
        '"summary": "the gist in one sentence", "fit": 0-100, "supporters": ["name"], '
        '"pros": ["pro"], "cons": ["con"], "why": "why it was chosen or discarded", '
        '"outcomes": [{"condition": "if…", "result": "then…", "tone": "good | neutral | bad"}]}], '
        '"path": [{"stage": "question | debate | turn | devil | conclusion", '
        '"title": "briefly", "text": "one or two sentences", "who": "who"}]}',
    )
    return f'{ctx}\n\n{head}{task}{schema}'
