import { copy, lang } from '../copy';

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
// Ключ входу живе в httpOnly-cookie: JavaScript (а отже й XSS) його не бачить.
// Тут — лише позначка, що на цьому пристрої увійшли: випадковий id входу, не секрет.
const SESSION_KEY = 'clarity_session';
// колишній токен у localStorage — прибираємо, щоб не лежав там вічно
const LEGACY_TOKEN_KEY = 'clarity_token';
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

try {
  localStorage.removeItem(LEGACY_TOKEN_KEY);
} catch {
  /* ignore (приватний режим тощо) */
}

// Особисте, що лишається в браузері: чернетка питання. На спільному пристрої
// наступна людина не має її побачити, тож вихід її стирає.
// Налаштування пристрою (тема, мова, звук) — не особисті, лишаються.
const PRIVATE_KEYS = ['clarity:draft-question'];

/** Вийшли з акаунта: стираємо позначку входу й особисте з цього браузера. */
export function forgetSession() {
  setSession(false);
  for (const key of PRIVATE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore (приватний режим тощо) */
    }
  }
}

/** Id поточного входу або null — чи показувати сторінки для тих, хто увійшов. */
export function getSession() {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/** true — щойно увійшли (новий id), false — вийшли. */
export function setSession(signedIn) {
  try {
    if (signedIn) {
      const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      localStorage.setItem(SESSION_KEY, id);
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore (приватний режим тощо) */
  }
}

export async function request(path, { method = 'GET', body, auth = false, signal } = {}) {
  // мова інтерфейсу: нею сервер пише помилки, а AI — відповіді нових дискусій
  // файли йдуть як multipart: заголовок із межею частин ставить сам браузер
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  // X-Requested-With — захист від CSRF: чужий сайт не може поставити цей заголовок
  const headers = isForm
    ? { 'Accept-Language': lang, 'X-Requested-With': 'XMLHttpRequest' }
    : { 'Content-Type': 'application/json', 'Accept-Language': lang, 'X-Requested-With': 'XMLHttpRequest' };

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined || isForm ? body : JSON.stringify(body),
      // cookie входу — і тоді, коли API на іншому origin (VITE_API_URL)
      credentials: 'include',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, { detail: copy.errors.noConnection });
  }

  const data = await res.json().catch(() => null);
  if (res.status === 401 && auth) {
    setSession(false);
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
