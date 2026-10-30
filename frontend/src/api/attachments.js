import { request } from './client';

/** Файл → текст на сервері: { id, name, kind, size, chars, truncated, preview }. */
export function uploadAttachment(file, { signal } = {}) {
  const form = new FormData();
  form.append('file', file);
  return request('/api/attachments/', { method: 'POST', auth: true, body: form, signal });
}

/** Прибрати файл, який ще не потрапив у дискусію. */
export function removeAttachment(id) {
  return request(`/api/attachments/${id}/`, { method: 'DELETE', auth: true });
}
