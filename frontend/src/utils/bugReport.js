// Діалог «Знайшли баги?» живе один на весь застосунок; відкривається подією,
// тож кнопку можна поставити будь-де — у меню, на лендингу, під реплікою AI.

export const OPEN_BUG_REPORT_EVENT = 'clarity:open-bug-report';
export const REPORT_KINDS = ['bug', 'ai_answer', 'idea', 'other'];
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 4000;

/**
 * Відкриває діалог. Усе необов'язкове:
 * `kind` — тип звернення, `text` — початок опису,
 * `messageId` — репліка, про яку звернення (тоді дискусію пропонуємо додати одразу),
 * `crash` — сторінка впала й технічний опис помилки вже записано.
 */
export const openBugReport = (detail = {}) =>
  window.dispatchEvent(new CustomEvent(OPEN_BUG_REPORT_EVENT, { detail }));

const DISCUSSION_PATH = /^\/chat\/([0-9a-f-]{36})(?:\/|$)/i;

/** Дискусія, відкрита зараз, — її можна додати до звернення. */
export const currentDiscussionId = (pathname = window.location.pathname) =>
  DISCUSSION_PATH.exec(pathname)?.[1] || null;

// проста перевірка адреси — остаточно її перевіряє сервер
export const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
