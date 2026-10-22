import { uk } from '../copy/uk';

const t = uk.chat;

const listOf = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);

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

/** Скільки блоків показує SummaryDetails — щоб наступні частини з'являлися після них. */
export function summaryDetailSteps(summary, view) {
  return (
    (summary?.answer ? 1 : 0)
    + 1
    + (view.confirmed === false && summary?.revision ? 1 : 0)
    + (view.agreement || view.confidence !== null ? 1 : 0)
    + view.lists.length
    + (summary?.recommendation ? 1 : 0)
  );
}
