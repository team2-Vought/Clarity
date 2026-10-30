import { copy } from '../copy';

const t = copy.chat;

const listOf = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);

const fold = (value) => String(value ?? '').trim().toLowerCase();

/** Нормалізований підсумок для показу: модель може пропустити чи зіпсувати поля. */
export function describeSummary(summary) {
  const confidence = Number.isFinite(Number(summary?.confidence)) && summary?.confidence !== null
    ? Math.max(0, Math.min(100, Math.round(Number(summary.confidence))))
    : null;
  return {
    decision: summary?.decision ? String(summary.decision) : '',
    confirmed: typeof summary?.confirmed === 'boolean' ? summary.confirmed : null,
    confidence,
    agreement: summary?.agreement?.total ? summary.agreement : null,
    lists: [
      { key: 'pros', title: t.summaryPros, items: listOf(summary?.pros) },
      { key: 'cons', title: t.summaryCons, items: listOf(summary?.cons) },
      { key: 'risks', title: t.summaryRisks, items: listOf(summary?.risks) },
      { key: 'dissent', title: t.summaryDissent, items: listOf(summary?.dissenting_points) },
    ].filter((list) => list.items.length > 0),
  };
}

/**
 * Головна відповідь у вигляді, що залежить від формату дискусії:
 * «так/ні» — одне велике слово, «один із варіантів» — усі варіанти з голосами
 * учасників і виділеним переможцем, вільна відповідь — текст рішення як стаття.
 * Голоси беруться з agreement.votes; у старих підсумках їх немає — тоді без смужок.
 */
export function describeVerdict(summary, mode, options) {
  const answer = summary?.answer ? String(summary.answer) : '';
  const votes = Array.isArray(summary?.agreement?.votes) ? summary.agreement.votes : [];
  if (mode === 'yes_no' && ['так', 'ні'].includes(fold(answer))) {
    return { kind: 'yes_no', yes: fold(answer) === 'так' };
  }
  if (mode === 'choose_one' && answer) {
    const labels = listOf(options);
    if (!labels.some((label) => fold(label) === fold(answer))) labels.push(answer);
    return {
      kind: 'choice',
      hasVotes: votes.length > 0,
      total: votes.length,
      options: labels.map((label) => ({
        label,
        winner: fold(label) === fold(answer),
        votes: votes.filter((vote) => fold(vote?.stance) === fold(label)).length,
      })),
    };
  }
  return { kind: 'open' };
}

/** Скільки блоків показує SummaryDetails — щоб наступні частини з'являлися після них. */
export function summaryDetailSteps(summary, view) {
  return (
    1
    + (view.agreement || view.confidence !== null ? 1 : 0)
    + (
      (view.confirmed === false && summary?.revision) || view.lists.length > 0 || summary?.recommendation
        ? 1
        : 0
    )
  );
}
