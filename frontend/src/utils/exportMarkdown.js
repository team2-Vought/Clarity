// Уся дискусія у Markdown: запитання, репліки по етапах і підсумок.
// PDF містить лише рішення, а тут — повний протокол, щоб поділитися ним
// чи зберегти в нотатки.

const listOf = (value) =>
  (Array.isArray(value) ? value : []).map((item) => String(item ?? '').trim()).filter(Boolean);

const quote = (text) =>
  String(text || '')
    .trim()
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');

/**
 * `labels` — тексти з copy (copy.chat), `phaseLabel(message)` — назва етапу,
 * `authorOf(message)` — ім'я автора так, як його видно в чаті,
 * `appendix` — готовий Markdown, що додається після висновку (наприклад, «Мої позначки»).
 */
export function discussionMarkdown(discussion, { labels, phaseLabel, authorOf, appendix = '' }) {
  const lines = [`# ${discussion.title || labels.exportTitle}`, '', quote(discussion.question), ''];
  const messages = (discussion.messages || []).filter((message, index, all) => {
    // перше повідомлення користувача — саме запитання, воно вже є вгорі
    const first = all.find((item) => item.role === 'user');
    return message !== first;
  });

  let phase = '';
  messages.forEach((message) => {
    const label = message.role === 'user' ? '' : phaseLabel(message);
    if (label && label !== phase) {
      phase = label;
      lines.push(`## ${label}`, '');
    }
    const head = [`**${authorOf(message)}**`];
    if (message.reply_to) head.push(`→ ${message.reply_to}`);
    if (message.stance) head.push(`_(${message.stance})_`);
    lines.push(head.join(' '), '', String(message.content || '').trim(), '');
  });

  const summary = discussion.final_summary;
  if (summary?.decision) {
    lines.push(`## ${labels.summary}`, '');
    if (summary.answer) lines.push(`**${labels.summaryAnswer}:** ${summary.answer}`, '');
    if (summary.headline) lines.push(`**${summary.headline}**`, '');
    lines.push(`**${labels.summaryDecision}:** ${summary.decision}`, '');
    if (summary.confirmed === false && summary.revision) {
      lines.push(`**${labels.summaryRevision}:** ${summary.revision}`, '');
    }
    const pair = (main, note) => (main && note ? `${main} — ${note}` : main || '');
    const riskPlan = Array.isArray(summary.risk_plan) && summary.risk_plan.length
      ? summary.risk_plan.map((item) => pair(item?.risk, item?.mitigation))
      : summary.risks;
    [
      [labels.summaryConditions, summary.conditions],
      [
        labels.summaryCompare,
        (summary.compare || []).map((row) =>
          row?.option ? `${row.option} — ${labels.summaryComparePro}: ${row.pro || '—'}; ${labels.summaryCompareCon}: ${row.con || '—'}` : ''),
      ],
      [labels.summaryPros, summary.pros],
      [labels.summaryCons, summary.cons],
      [labels.summaryRisks, riskPlan],
      [labels.summaryUnknowns, (summary.unknowns || []).map((item) => pair(item?.question, item?.how))],
      [labels.summaryPlanB, summary.plan_b ? [summary.plan_b] : []],
      [labels.summaryDissent, summary.dissenting_points],
    ].forEach(([title, items]) => {
      const list = listOf(items);
      if (list.length) lines.push(`**${title}:**`, '', ...list.map((item) => `- ${item}`), '');
    });
    const plan = listOf(summary.next_steps);
    if (plan.length) {
      lines.push(`**${labels.summaryPlan}:**`, '', ...plan.map((item, index) => `${index + 1}. ${item}`), '');
    } else if (summary.recommendation) {
      lines.push(`**${labels.summaryNextStep}:** ${summary.recommendation}`, '');
    }
    const triggers = listOf(summary.change_triggers);
    if (triggers.length) {
      lines.push(`**${labels.summaryTriggers}:**`, '', ...triggers.map((item) => `- ${item}`), '');
    }
  }

  // дерево рішень — коли людина його вже склала
  const tree = discussion.decision_tree;
  if (tree?.branches?.length && labels.tree) {
    const t = labels.tree;
    lines.push(`## ${t.title}`, '');
    tree.branches.forEach((branch) => {
      const mark = branch.status === 'chosen' ? '✅' : branch.status === 'rejected' ? '✖️' : '◽';
      const fit = branch.fit !== null && branch.fit !== undefined ? ` · ${t.fit}: ${branch.fit}%` : '';
      lines.push(`### ${mark} ${branch.title}`, '', `_${t.status[branch.status] || ''}${fit}_`, '');
      if (branch.summary) lines.push(branch.summary, '');
      if (branch.why) lines.push(`**${t.why[branch.status] || t.why.alternative}:** ${branch.why}`, '');
      (branch.outcomes || []).forEach((outcome) => {
        lines.push(`- ${[outcome.condition, outcome.result].filter(Boolean).join(' → ')}`);
      });
      if (branch.outcomes?.length) lines.push('');
    });
    const path = tree.path || [];
    if (path.length) {
      lines.push(`**${t.path}:**`, '');
      path.forEach((step, index) => {
        const who = step.who?.name ? ` (${step.who.name})` : '';
        lines.push(`${index + 1}. **${step.title}**${who}${step.text ? ` — ${step.text}` : ''}`);
      });
      lines.push('');
    }
  }

  // позначки людини (utils/marks.js) — після висновку, перед джерелами
  if (appendix) lines.push(appendix.trim(), '');

  const sources = discussion.sources || [];
  if (sources.length) {
    lines.push(`## ${labels.sources}`, '');
    sources.forEach((source) => lines.push(`${source.id}. [${source.title || source.url}](${source.url})`));
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Ім'я файлу з назви дискусії: без символів, заборонених у файлових системах. */
export function markdownFileName(title) {
  const base = String(title || 'clarity')
    .replace(/[\\/:*?"<>|\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return `${base || 'clarity'}.md`;
}

export function downloadText(text, fileName, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
