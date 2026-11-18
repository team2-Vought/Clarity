import { recordError } from '../utils/diagnostics';
import { copy, lang } from '../copy';

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
// Ключ входу живе в httpOnly-cookie: JavaScript (а отже й XSS) його не бачить.
// Тут — лише позначка, що на цьому пристрої увійшли: випадковий id входу, не секрет.
const SESSION_KEY = 'clarity_session';
// колишній токен у localStorage — прибираємо, щоб не лежав там вічно
const LEGACY_TOKEN_KEY = 'clarity_token';
// Подія для Layout: токен прострочено або відкликано — треба знову увійти
export const UNAUTHORIZED_EVENT = 'clarity:unauthorized';

// відповідь без пояснення (502 від проксі віддає HTML, а не JSON) — зрозумілий текст за кодом
const statusText = (status) => copy.errors.http[status] || copy.errors.httpOther(status);

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.detail || statusText(status));
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
// гостьовий вхід без реєстрації (accounts/guest.py на сервері): сторінки входу
// й реєстрації для гостя не ховаються — саме там він зберігає дискусію в акаунт
const GUEST_KEY = 'clarity:guest';

/** Чи на цьому пристрої увійшли гостем. */
export function isGuestSession() {
  try {
    return localStorage.getItem(GUEST_KEY) === '1';
  } catch {
    return false;
  }
}

export function setGuestSession(guest) {
  try {
    if (guest) localStorage.setItem(GUEST_KEY, '1');
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    /* ignore (приватний режим тощо) */
  }
}

/** Розбудити API заздалегідь: безкоштовний сервер засинає, і перший запит чекає до хвилини.
 *  Лендинг і сторінки входу шлють цей запит одразу — поки людина читає, сервер прокидається. */
let woken = false;
export function wakeServer() {
  if (woken) return;
  woken = true;
  fetch(`${BASE_URL}/api/health/`, { credentials: 'omit' }).catch(() => {
    woken = false;
  });
}

/** Вийшли з акаунта: стираємо позначку входу й особисте з цього браузера. */
export function forgetSession() {
  setSession(false);
  setGuestSession(false);
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

/** Двійкова відповідь (аудіо): Blob або ApiError зі статусом (0 — немає зв'язку). */
export async function requestBlob(path, { method = 'POST', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept-Language': lang, 'X-Requested-With': 'XMLHttpRequest' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, null);
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res.blob();
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
    recordError('network', `${method} ${path.split('?')[0]}: ${err?.message || 'failed'}`);
    throw new ApiError(0, { detail: copy.errors.noConnection });
  }

  const data = await res.json().catch(() => null);
  if (res.status === 401 && auth) {
    setSession(false);
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  // збої сервера потрапляють у технічні дані звернення «Знайшли баги?» (без query — там бувають токени)
  if (res.status >= 500) recordError('api', `${method} ${path.split('?')[0]} → ${res.status}`);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
