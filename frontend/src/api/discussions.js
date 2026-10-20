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

export function createDiscussion({ question, mode, options, personas, rounds }) {
  return request('/api/discussions/', {
    method: 'POST',
    auth: true,
    body: { question, mode, options, personas, rounds },
  });
}

export function fetchDiscussion(id) {
  return request(`/api/discussions/${id}/`, { auth: true });
}

export function advanceDiscussion(id) {
  return request(`/api/discussions/${id}/advance/`, {
    method: 'POST',
    auth: true,
  });
}
