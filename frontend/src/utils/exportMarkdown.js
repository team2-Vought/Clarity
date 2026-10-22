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
 * `labels` — тексти з copy (uk.chat), `phaseLabel(message)` — назва етапу,
 * `authorOf(message)` — ім'я автора так, як його видно в чаті.
 */
export function discussionMarkdown(discussion, { labels, phaseLabel, authorOf }) {
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
    lines.push(`**${labels.summaryDecision}:** ${summary.decision}`, '');
    if (summary.confirmed === false && summary.revision) {
      lines.push(`**${labels.summaryRevision}:** ${summary.revision}`, '');
    }
    [
      [labels.summaryPros, summary.pros],
      [labels.summaryCons, summary.cons],
      [labels.summaryRisks, summary.risks],
      [labels.summaryDissent, summary.dissenting_points],
    ].forEach(([title, items]) => {
      const list = listOf(items);
      if (list.length) lines.push(`**${title}:**`, '', ...list.map((item) => `- ${item}`), '');
    });
    if (summary.recommendation) {
      lines.push(`**${labels.summaryNextStep}:** ${summary.recommendation}`, '');
    }
  }

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
