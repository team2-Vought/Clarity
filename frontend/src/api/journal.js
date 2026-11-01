import { request } from './client';

/** Журнал рішень: { results, due_count }. */
export function fetchJournal() {
  return request('/api/journal/', { auth: true });
}

/** Скільки рішень чекають на «Як воно?» і найдавніше з них: { count, next }. */
export function fetchJournalDue() {
  return request('/api/journal/due/', { auth: true });
}

/** Записати рішення дискусії; повторний запис оновлює те саме рішення. */
export function recordDecision({ discussion, decision, remindInDays }) {
  return request('/api/journal/', {
    method: 'POST',
    auth: true,
    body: { discussion, decision, remind_in_days: remindInDays },
  });
}

/** Підсумок (outcome, reflection), зроблені кроки (done_steps) чи «ще рано» (remind_in_days). */
export function updateDecision(id, changes) {
  return request(`/api/journal/${id}/`, { method: 'PATCH', auth: true, body: changes });
}

export function deleteDecision(id) {
  return request(`/api/journal/${id}/`, { method: 'DELETE', auth: true });
}

/** Відписка від листів журналу за посиланням із листа — без входу. */
export function unsubscribeJournal(token) {
  return request(`/api/journal/unsubscribe/${encodeURIComponent(token)}/`, { method: 'POST' });
}
