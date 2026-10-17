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
