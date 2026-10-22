// Готові сценарії для стартової сторінки: формат відповіді, склад ролей,
// раунди й пошук. Тексти (назва, заготовка питання) — у copy/uk.js.
export const DEBATE_TEMPLATES = [
  { id: 'buy', mode: 'yes_no', roles: ['pragmatist', 'skeptic', 'emotional'], rounds: 2, webSearch: true },
  { id: 'career', mode: 'yes_no', roles: ['pragmatist', 'emotional', 'skeptic', 'logician'], rounds: 2, webSearch: true },
  { id: 'choice', mode: 'choose_one', roles: ['logician', 'pragmatist', 'creative'], rounds: 2, webSearch: true },
  { id: 'business', mode: 'open', roles: ['pragmatist', 'skeptic', 'creative', 'logician'], rounds: 3, webSearch: true },
  { id: 'personal', mode: 'open', roles: ['emotional', 'logician', 'creative'], rounds: 2, webSearch: false },
  { id: 'learning', mode: 'open', roles: ['pragmatist', 'logician', 'creative'], rounds: 2, webSearch: true },
];
