// Позначки людини в дискусії — реакції й виділення — як конспект:
// для панелі «Мої позначки», копіювання й експорту в Markdown.

import { copy } from '../copy';

const t = copy.marks;

/** Репліки з позначками в порядку дискусії: [{ message, author, highlights }]. */
export const markEntries = (messages, authorOf) =>
  (messages || [])
    .filter((message) => message.reaction || message.highlights?.length)
    .map((message) => ({
      message,
      author: authorOf(message),
      highlights: message.highlights || [],
    }));

const oneLine = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/** Конспект у Markdown: автор, реакція, цитати з позначкою значення й нотатки. */
export const marksMarkdown = (entries, { title = t.panelTitle, level = 2 } = {}) => {
  if (!entries?.length) return '';
  const heading = '#'.repeat(level);
  const lines = [`${heading} ${title}`, ''];
  entries.forEach(({ message, author, highlights }) => {
    const reaction = message.reaction ? ` — ${t.reactions[message.reaction]}` : '';
    lines.push(`**${oneLine(author)}**${reaction}`, '');
    highlights.forEach((highlight) => {
      lines.push(`> ${oneLine(highlight.quote)}`);
      const note = oneLine(highlight.note);
      lines.push(`> — *${t.colors[highlight.color] || highlight.color}*${note ? `: ${note}` : ''}`, '');
    });
  });
  return `${lines.join('\n').trim()}\n`;
};

/** Замінює в списку повідомлень одне — так реакції й виділення оновлюються на місці. */
export const patchMessage = (messages, messageId, change) =>
  (messages || []).map((message) => (message.id === messageId ? { ...message, ...change(message) } : message));
