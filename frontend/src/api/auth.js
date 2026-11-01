import { forgetSession, request, setSession } from './client';

// Сервер ставить ключ входу в httpOnly-cookie сам; тут лише позначаємо, що увійшли

/** Реєстрація не входить в акаунт: далі людина входить зі своїм паролем. */
export function register({ name, email, password, confirm_password }) {
  return request('/api/auth/register/', {
    method: 'POST',
    body: { name, email, password, confirm_password },
  });
}

export async function login({ email, password }) {
  const data = await request('/api/auth/login/', {
    method: 'POST',
    body: { email, password },
  });
  setSession(true);
  return data;
}

/** `client_id` для кнопки Google; порожній — вхід через Google не налаштовано. */
export function googleConfig() {
  return request('/api/auth/google/');
}

/** Вхід або реєстрація за access-токеном від Google. */
export async function googleLogin(accessToken) {
  const data = await request('/api/auth/google/', {
    method: 'POST',
    body: { access_token: accessToken },
  });
  setSession(true);
  return data;
}

export async function logout() {
  try {
    await request('/api/auth/logout/', { method: 'POST', auth: true });
  } catch {
    /* вихід локально навіть якщо сервер недоступний */
  } finally {
    forgetSession();
  }
}

/** Усі дані акаунта (GDPR): профіль, дискусії, журнал, вкладення, входи. */
export function exportAccount() {
  return request('/api/auth/export/', { auth: true });
}

/** Входи на пристроях: [{ id, device, last_used_at, current }]. */
export function listSessions() {
  return request('/api/auth/sessions/', { auth: true });
}

/** Вийти на одному пристрої. */
export function revokeSession(id) {
  return request(`/api/auth/sessions/${id}/`, { method: 'DELETE', auth: true });
}

export function me() {
  return request('/api/auth/me/', { auth: true });
}

/** Ім’я або пошта; нова пошта — лише з `current_password`. Пошта змінюється не одразу:
 *  сервер надсилає лист на нову адресу й повертає `email_pending`. */
export function updateProfile(changes) {
  return request('/api/auth/me/', { method: 'PATCH', auth: true, body: changes });
}

/** Посилання з листа про нову пошту: { email }. */
export function confirmEmailChange(token) {
  return request('/api/auth/email/confirm/', { method: 'POST', body: { token } });
}

/** Новий пароль: інші пристрої виходять, цей лишається в акаунті. */
export function changePassword({ current_password, password, confirm_password }) {
  return request('/api/auth/password/', {
    method: 'POST',
    auth: true,
    body: { current_password, password, confirm_password },
  });
}

/** Лист із посиланням на новий пароль; відповідь та сама, є такий акаунт чи ні. */
export function requestPasswordReset(email) {
  return request('/api/auth/password-reset/', { method: 'POST', body: { email } });
}

/** Чи посилання з листа ще дійсне: { valid }. */
export function checkResetLink(uid, token) {
  const query = new URLSearchParams({ uid, token });
  return request(`/api/auth/password-reset/confirm/?${query}`);
}

/** Новий пароль за посиланням; сервер одразу входить в акаунт на цьому пристрої. */
export async function confirmPasswordReset({ uid, token, password, confirm_password }) {
  const data = await request('/api/auth/password-reset/confirm/', {
    method: 'POST',
    body: { uid, token, password, confirm_password },
  });
  setSession(true);
  return data;
}

export async function deleteAccount(password) {
  await request('/api/auth/me/', { method: 'DELETE', auth: true, body: { password } });
  forgetSession();
}
