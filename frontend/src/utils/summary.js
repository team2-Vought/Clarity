import { copy } from '../copy';

const t = copy.chat;

const listOf = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);

const fold = (value) => String(value ?? '').trim().toLowerCase();

const pairsOf = (value, first, second) =>
  (Array.isArray(value) ? value : [])
    .map((item) => ({
      main: String(item?.[first] ?? '').trim(),
      note: String(item?.[second] ?? '').trim(),
    }))
    .filter((item) => item.main);

const joinPair = ({ main, note }) => (note ? `${main} — ${note}` : main);

/**
 * Нормалізований підсумок для показу: модель може пропустити чи зіпсувати поля.
 * `lists` — усі розділи-списки рядками в порядку показу (для копіювання й PDF);
 * `riskPlan` і `unknowns` — ті самі ризики й невідомі парами для картки.
 * Старі підсумки не мають headline, умов, плану Б тощо — тоді розділів просто немає.
 */
export function describeSummary(summary) {
  const confidence = Number.isFinite(Number(summary?.confidence)) && summary?.confidence !== null
    ? Math.max(0, Math.min(100, Math.round(Number(summary.confidence))))
    : null;
  // ризики з тим, як їх зменшити; у старих підсумках — лише рядки
  const riskPlan = pairsOf(summary?.risk_plan, 'risk', 'mitigation');
  const risks = riskPlan.length ? riskPlan : listOf(summary?.risks).map((main) => ({ main, note: '' }));
  const unknowns = pairsOf(summary?.unknowns, 'question', 'how');
  const planB = summary?.plan_b ? String(summary.plan_b).trim() : '';
  const dissent = listOf(summary?.dissenting_points);
  // «Один із варіантів»: за й проти кожного варіанта
  const compare = (Array.isArray(summary?.compare) ? summary.compare : [])
    .map((row) => ({
      option: String(row?.option ?? '').trim(),
      pro: String(row?.pro ?? '').trim(),
      con: String(row?.con ?? '').trim(),
    }))
    .filter((row) => row.option);
  return {
    headline: summary?.headline ? String(summary.headline).trim() : '',
    decision: summary?.decision ? String(summary.decision) : '',
    confirmed: typeof summary?.confirmed === 'boolean' ? summary.confirmed : null,
    confidence,
    agreement: summary?.agreement?.total ? summary.agreement : null,
    conditions: listOf(summary?.conditions),
    // план дій: кроки на тиждень і сигнали, коли варто переглянути рішення
    plan: listOf(summary?.next_steps),
    triggers: listOf(summary?.change_triggers),
    riskPlan: risks,
    unknowns,
    planB,
    dissent,
    compare,
    lists: [
      { key: 'conditions', title: t.summaryConditions, items: listOf(summary?.conditions) },
      {
        key: 'compare',
        title: t.summaryCompare,
        items: compare.map((row) => `${row.option} — ${t.summaryComparePro}: ${row.pro || '—'}; ${t.summaryCompareCon}: ${row.con || '—'}`),
      },
      { key: 'pros', title: t.summaryPros, items: listOf(summary?.pros) },
      { key: 'cons', title: t.summaryCons, items: listOf(summary?.cons) },
      { key: 'risks', title: t.summaryRisks, items: risks.map(joinPair) },
      { key: 'unknowns', title: t.summaryUnknowns, items: unknowns.map(joinPair) },
      { key: 'planB', title: t.summaryPlanB, items: planB ? [planB] : [] },
      { key: 'dissent', title: t.summaryDissent, items: dissent },
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
      (view.confirmed === false && summary?.revision)
      || view.lists.length > 0
      || summary?.recommendation
      || view.plan?.length
      || view.triggers?.length
        ? 1
        : 0
    )
  );
}
