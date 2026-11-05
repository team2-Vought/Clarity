// Технічні дані для звернення «Знайшли баги?»: браузер, екран, тема й кілька
// останніх помилок на сторінці. Людина бачить усе це перед надсиланням і може
// не додавати. Нічого особистого: ні тексту дискусій, ні адрес із токенами.

const ERRORS_MAX = 10;
const MESSAGE_MAX = 300;
const errors = [];
let installed = false;

const clip = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

// адреса без query й # — там бувають токени скидання пароля чи посилань
const safeSource = (value) => {
  try {
    const url = new URL(String(value || ''), window.location.origin);
    return url.origin === window.location.origin ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
};

/** Запам'ятовує помилку; найстаріші випадають, коли їх більше за ERRORS_MAX. */
export const recordError = (kind, message, source = '') => {
  const text = clip(message, MESSAGE_MAX);
  if (!text) return;
  const last = errors[errors.length - 1];
  // та сама помилка поспіль (наприклад, у циклі опитування) — один запис
  if (last && last.message === text && last.kind === kind) return;
  errors.push({ kind, message: text, source: clip(safeSource(source), 200), at: new Date().toISOString() });
  if (errors.length > ERRORS_MAX) errors.shift();
};

export const recentErrors = () => errors.map((item) => ({ ...item }));

/** Слухає помилки скриптів і необроблені проміси — один раз на весь застосунок. */
export const installDiagnostics = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => {
    recordError('error', event.message || event.error?.message, event.filename);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    // скасовані запити (перехід з однієї сторінки на іншу) — не помилка
    if (reason?.name === 'AbortError') return;
    recordError('promise', reason?.message || reason);
  });
};

const visionSummary = (root) =>
  ['textScale', 'contrast', 'font', 'spacing', 'links', 'focus', 'cursor', 'motion']
    .filter((key) => root.dataset[key])
    .map((key) => `${key}=${root.dataset[key]}`)
    .join(', ');

/** Те, що піде в звернення, — саме в такому вигляді людина бачить це в діалозі. */
export const collectContext = () => {
  const root = document.documentElement;
  let timezone = '';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    timezone = '';
  }
  const context = {
    user_agent: navigator.userAgent || '',
    language: root.lang || '',
    theme: root.dataset.theme || '',
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    screen: window.screen ? `${window.screen.width}×${window.screen.height} @${window.devicePixelRatio || 1}x` : '',
    timezone,
    vision: visionSummary(root),
    build: typeof __APP_BUILD__ === 'undefined' ? '' : __APP_BUILD__,
    online: navigator.onLine !== false,
    errors: recentErrors(),
  };
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : value !== ''
    )
  );
};

/** Тестам: почати з чистого списку помилок. */
export const resetDiagnostics = () => {
  errors.length = 0;
};
