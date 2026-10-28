import { request, setToken } from './client';

function pickToken(data) {
  return data?.token ?? data?.key ?? data?.access ?? null;
}

export async function register({ name, email, password, confirm_password }) {
  const data = await request('/api/auth/register/', {
    method: 'POST',
    body: { name, email, password, confirm_password },
  });
  const token = pickToken(data);
  if (token) setToken(token);
  return data;
}

export async function login({ email, password }) {
  const data = await request('/api/auth/login/', {
    method: 'POST',
    body: { email, password },
  });
  const token = pickToken(data);
  if (token) setToken(token);
  return data;
}

export async function logout() {
  try {
    await request('/api/auth/logout/', { method: 'POST', auth: true });
  } catch {
    /* вихід локально навіть якщо сервер недоступний */
  } finally {
    setToken(null);
  }
}

export function me() {
  return request('/api/auth/me/', { auth: true });
}

/** Ім’я або пошта; нова пошта — лише з `current_password`. */
export function updateProfile(changes) {
  return request('/api/auth/me/', { method: 'PATCH', auth: true, body: changes });
}

/** Сервер видає новий токен — старий (і всі інші пристрої) виходять. */
export async function changePassword({ current_password, password, confirm_password }) {
  const data = await request('/api/auth/password/', {
    method: 'POST',
    auth: true,
    body: { current_password, password, confirm_password },
  });
  const token = pickToken(data);
  if (token) setToken(token);
  return data;
}

export async function deleteAccount(password) {
  await request('/api/auth/me/', { method: 'DELETE', auth: true, body: { password } });
  setToken(null);
}
