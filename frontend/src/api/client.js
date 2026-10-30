import { copy, lang } from '../copy';

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'clarity_token';
// Подія для Layout: токен прострочено або відкликано — треба знову увійти
export const UNAUTHORIZED_EVENT = 'clarity:unauthorized';

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.detail || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }

  /** Помилки полів з DRF: { field: ['msg'] } -> { field: 'msg' } */
  fieldErrors() {
    if (!this.data || typeof this.data !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(this.data)) {
      if (key === 'detail' || key === 'non_field_errors') continue;
      out[key] = Array.isArray(value) ? value.join(' ') : String(value);
    }
    return out;
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore (приватний режим тощо) */
  }
}

export async function request(path, { method = 'GET', body, auth = false, signal } = {}) {
  // мова інтерфейсу: нею сервер пише помилки, а AI — відповіді нових дискусій
  // файли йдуть як multipart: заголовок із межею частин ставить сам браузер
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = isForm
    ? { 'Accept-Language': lang }
    : { 'Content-Type': 'application/json', 'Accept-Language': lang };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Token ${token}`;
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined || isForm ? body : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, { detail: copy.errors.noConnection });
  }

  const data = await res.json().catch(() => null);
  if (res.status === 401 && auth) {
    setToken(null);
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
