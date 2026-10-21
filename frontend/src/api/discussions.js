import { request } from './client';

export function fetchPersonas() {
  return request('/api/personas/', { auth: true });
}

export function fetchModels() {
  return request('/api/models/', { auth: true });
}

export function fetchDiscussions() {
  return request('/api/discussions/', { auth: true });
}

export function createDiscussion({
  question,
  mode,
  options,
  personas,
  rounds,
  webSearch,
  moderatorModel,
  devilModel,
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
      web_search: webSearch,
      moderator_model: moderatorModel,
      devil_model: devilModel,
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

/** Зупинка після поточного кроку. */
export function stopDiscussion(id) {
  return request(`/api/discussions/${id}/stop/`, { method: 'POST', auth: true });
}

/** Уточнення користувача: під час дискусії або після фіналу. */
export function postNote(id, content) {
  return request(`/api/discussions/${id}/messages/`, {
    method: 'POST',
    auth: true,
    body: { content },
  });
}

/** Зміна моделей учасників і суддів, поки дискусія не виконується. */
export function updateDiscussion(id, { personas, moderatorModel, devilModel }) {
  const body = {};
  if (personas) body.personas = personas;
  if (moderatorModel !== undefined) body.moderator_model = moderatorModel;
  if (devilModel !== undefined) body.devil_model = devilModel;
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
