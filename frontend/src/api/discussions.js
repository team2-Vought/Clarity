import { request } from './client';

export function fetchPersonas() {
  return request('/api/personas/', { auth: true });
}

export function fetchModels() {
  return request('/api/models/', { auth: true });
}

/** Сторінка історії: `status`, `q` і `archived` фільтрують на сервері, `offset` — для «Показати ще». */
export function fetchDiscussions({ offset = 0, limit, status, q, archived = false, signal } = {}) {
  const params = new URLSearchParams();
  if (archived) params.set('archived', '1');
  if (offset) params.set('offset', String(offset));
  if (limit) params.set('limit', String(limit));
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  const query = params.toString();
  return request(`/api/discussions/${query ? `?${query}` : ''}`, { auth: true, signal });
}

export function createDiscussion({
  question,
  mode,
  options,
  personas,
  rounds,
  untilConsensus = false,
  webSearch,
  moderatorModel,
  devilModel,
  useProfile,
  attachments = [],
  quick = false,
  criteria = [],
}) {
  return request('/api/discussions/', {
    method: 'POST',
    auth: true,
    body: {
      question,
      mode,
      options,
      personas,
      rounds,
      until_consensus: untilConsensus,
      web_search: webSearch,
      moderator_model: moderatorModel,
      devil_model: devilModel,
      // без значення сервер бере вибір із самого профілю
      ...(useProfile === undefined ? {} : { use_profile: useProfile }),
      attachments,
      quick,
      criteria,
    },
  });
}

/** `after` — повернути лише повідомлення з seq > after (для опитування). */
export function fetchDiscussion(id, { after, signal } = {}) {
  const query = Number.isFinite(after) ? `?after=${after}` : '';
  return request(`/api/discussions/${id}/${query}`, { auth: true, signal });
}

/** Запускає фонове виконання дискусії на сервері. */
export function runDiscussion(id) {
  return request(`/api/discussions/${id}/run/`, { method: 'POST', auth: true });
}

/** Відповіді на питання модератора: [{ question, answer }]; порожньо — пропустити. */
export function answerClarify(id, answers) {
  return request(`/api/discussions/${id}/clarify/`, {
    method: 'POST',
    auth: true,
    body: { answers },
  });
}

/** Зупинка після поточного кроку. */
export function stopDiscussion(id) {
  return request(`/api/discussions/${id}/stop/`, { method: 'POST', auth: true });
}

/** «Завершити»: зупинена дискусія одразу переходить до висновку модератора. */
export function finishDiscussion(id) {
  return request(`/api/discussions/${id}/finish/`, { method: 'POST', auth: true });
}

/** Уточнення користувача: під час дискусії або після фіналу. */
/** Уточнення; після висновку `target` — slug учасника, якому адресоване питання. */
export function postNote(id, content, target = '') {
  return request(`/api/discussions/${id}/messages/`, {
    method: 'POST',
    auth: true,
    body: target ? { content, target } : { content },
  });
}

/** «Допомогло» / «Не допомогло» під висновком; порожнє value — скасувати. */
export function sendFeedback(id, value, note = '') {
  return request(`/api/discussions/${id}/feedback/`, {
    method: 'POST',
    auth: true,
    body: { value, note },
  });
}

/** Свої ролі учасників: «юрист», «мій обережний тато». */
export function fetchCustomRoles() {
  return request('/api/personas/custom/', { auth: true });
}

export function createCustomRole({ name, description }) {
  return request('/api/personas/custom/', { method: 'POST', auth: true, body: { name, description } });
}

export function deleteCustomRole(id) {
  return request(`/api/personas/custom/${id}/`, { method: 'DELETE', auth: true });
}

/** Зміна моделей учасників і суддів, поки дискусія не виконується. */
export function updateDiscussion(id, { personas, moderatorModel, devilModel, pinned, archived }) {
  const body = {};
  if (personas) body.personas = personas;
  if (moderatorModel !== undefined) body.moderator_model = moderatorModel;
  if (devilModel !== undefined) body.devil_model = devilModel;
  if (pinned !== undefined) body.pinned = pinned;
  if (archived !== undefined) body.archived = archived;
  return request(`/api/discussions/${id}/`, { method: 'PATCH', auth: true, body });
}

export function advanceDiscussion(id, { signal } = {}) {
  return request(`/api/discussions/${id}/advance/`, {
    method: 'POST',
    auth: true,
    signal,
  });
}

export function deleteDiscussion(id) {
  return request(`/api/discussions/${id}/`, {
    method: 'DELETE',
    auth: true,
  });
}

/** Публічне посилання лише для читання: вмикає (або повертає наявне). */
export function shareDiscussion(id) {
  return request(`/api/discussions/${id}/share/`, { method: 'POST', auth: true });
}

/** Закриває доступ: старе посилання перестає відкриватися. */
export function unshareDiscussion(id) {
  return request(`/api/discussions/${id}/share/`, { method: 'DELETE', auth: true });
}

/** Дискусія за публічним посиланням — без входу. */
export function fetchSharedDiscussion(token) {
  return request(`/api/shared/${token}/`);
}

export function fetchTeams() {
  return request('/api/teams/', { auth: true });
}

/** Зберігає команду; з наявною назвою — оновлює її. */
export function saveTeam({ name, personas, moderatorModel, devilModel }) {
  return request('/api/teams/', {
    method: 'POST',
    auth: true,
    body: { name, personas, moderator_model: moderatorModel, devil_model: devilModel },
  });
}

export function deleteTeam(id) {
  return request(`/api/teams/${id}/`, { method: 'DELETE', auth: true });
}
