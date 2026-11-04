// Режим для людей із порушеннями зору — налаштування цього пристрою, не акаунта:
// людина має знайти й увімкнути його ще до входу (на лендингу чи сторінці входу).
// Кожна опція — атрибут на <html>, а самі стилі живуть у styles/vision.css.
// До першого кадру ті самі атрибути ставить public/theme.js — тож тут і там
// має бути однаковий ключ сховища й однакові назви атрибутів.

import { readReducedMotion, writeReducedMotion } from './devicePrefs';

export const VISION_KEY = 'clarity:vision';
export const TEXT_SCALES = [100, 125, 150, 175];

export const VISION_DEFAULTS = Object.freeze({
  scale: 100,
  contrast: 'normal',
  font: 'default',
  spacing: false,
  links: false,
  focus: false,
  cursor: false,
});

// «Режим для слабозорих» одним натиском
export const VISION_PRESET = Object.freeze({
  scale: 150,
  contrast: 'high',
  font: 'readable',
  spacing: true,
  links: true,
  focus: true,
  cursor: true,
});

const CONTRAST_QUERY = '(prefers-contrast: more)';
const systemWantsContrast = () => {
  try {
    return Boolean(window.matchMedia?.(CONTRAST_QUERY).matches);
  } catch {
    return false;
  }
};

const readStored = () => {
  try {
    const raw = localStorage.getItem(VISION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Очищує збережене: невідомі ключі й значення поза дозволеними відкидаються. */
export const sanitizeVision = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const bool = (key) => (typeof source[key] === 'boolean' ? source[key] : VISION_DEFAULTS[key]);
  return {
    scale: TEXT_SCALES.includes(source.scale) ? source.scale : VISION_DEFAULTS.scale,
    // поки людина сама не обрала, висока контрастність іде за налаштуванням ОС
    contrast:
      source.contrast === 'high' || source.contrast === 'normal'
        ? source.contrast
        : systemWantsContrast()
          ? 'high'
          : 'normal',
    font: source.font === 'readable' ? 'readable' : 'default',
    spacing: bool('spacing'),
    links: bool('links'),
    focus: bool('focus'),
    cursor: bool('cursor'),
  };
};

const sameAs = (prefs, target) =>
  Object.keys(VISION_DEFAULTS).every((key) => prefs[key] === target[key]);

/** Чи відрізняється хоч щось від звичайного вигляду. */
export const isVisionActive = (prefs) => !sameAs(prefs, VISION_DEFAULTS);

let fontRequested = false;
// розбірливий шрифт важить ~200 КБ — вантажимо його лише тим, хто його обрав
const loadReadableFont = () => {
  if (fontRequested) return;
  fontRequested = true;
  Promise.all([import('@fontsource/andika/400.css'), import('@fontsource/andika/700.css')]).catch(
    () => {
      fontRequested = false;
    }
  );
};

/** Переносить налаштування на <html> як data-атрибути. */
export const applyVision = (prefs, root = document.documentElement) => {
  const set = (name, value) => {
    if (value) root.dataset[name] = value;
    else delete root.dataset[name];
  };
  set('textScale', prefs.scale !== 100 ? String(prefs.scale) : '');
  set('contrast', prefs.contrast === 'high' ? 'high' : '');
  set('font', prefs.font === 'readable' ? 'readable' : '');
  set('spacing', prefs.spacing ? 'wide' : '');
  set('links', prefs.links ? 'underline' : '');
  set('focus', prefs.focus ? 'strong' : '');
  set('cursor', prefs.cursor ? 'large' : '');
  if (prefs.font === 'readable') loadReadableFont();
};

// ---- спільний стан для всіх компонентів (і всіх вкладок браузера) ----

const listeners = new Set();
let snapshot = null;

const build = () => ({ ...sanitizeVision(readStored()), motion: readReducedMotion() });

export const getVision = () => {
  if (!snapshot) snapshot = build();
  return snapshot;
};

const emit = () => {
  snapshot = build();
  applyVision(snapshot);
  listeners.forEach((listener) => listener());
};

const persist = (prefs, extra = {}) => {
  try {
    const { motion: _motion, ...rest } = prefs;
    const stored = readStored() || {};
    const next = { ...rest, ...extra };
    if (stored.motionByMode && !('motionByMode' in extra)) next.motionByMode = true;
    // звичайний вигляд не зберігаємо — крім явного «звичайна» всупереч prefers-contrast ОС
    const plain = !isVisionActive(rest) && !next.motionByMode && !systemWantsContrast();
    if (plain) localStorage.removeItem(VISION_KEY);
    else localStorage.setItem(VISION_KEY, JSON.stringify(next));
  } catch {
    // без сховища налаштування діє до перезавантаження
    snapshot = { ...prefs, motion: readReducedMotion() };
    applyVision(snapshot);
    listeners.forEach((listener) => listener());
    return false;
  }
  return true;
};

const handleStorage = (event) => {
  if (event.key === VISION_KEY || event.key === 'clarity:motion' || event.key === null) emit();
};

export const subscribeVision = (listener) => {
  if (!listeners.size) window.addEventListener('storage', handleStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', handleStorage);
  };
};

/** Змінює одну чи кілька опцій; `motion` — це спільне «Менше анімації». */
export const updateVision = (changes) => {
  const current = getVision();
  if ('motion' in changes) {
    writeReducedMotion(Boolean(changes.motion));
  }
  const next = { ...current, ...changes };
  const extra = 'motion' in changes ? { motionByMode: false } : {};
  if (persist(next, extra)) emit();
};

/** Головний перемикач: вмикає весь набір або повертає звичайний вигляд. */
export const setVisionMode = (on) => {
  if (on) {
    const turnMotion = !readReducedMotion();
    if (turnMotion) writeReducedMotion(true);
    if (persist({ ...VISION_PRESET }, { motionByMode: turnMotion })) emit();
    return;
  }
  // «Менше анімації» вимикаємо, лише якщо його ввімкнув сам режим
  if (readStored()?.motionByMode) writeReducedMotion(false);
  if (persist({ ...VISION_DEFAULTS, motion: readReducedMotion() }, { motionByMode: false })) emit();
};

/** Застосовує збережене одразу після завантаження застосунку (шрифт тощо). */
export const initVision = () => applyVision(getVision());

// ---- панель «Зір» поверх будь-якої сторінки ----

export const OPEN_VISION_EVENT = 'clarity:open-vision';

export const openVisionPanel = () => window.dispatchEvent(new Event(OPEN_VISION_EVENT));

/** Alt + Shift + V — за фізичною клавішею, тож працює й на українській розкладці. */
export const isVisionShortcut = (e) =>
  e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyV';

/** Тестам: скинути кеш між випадками. */
export const resetVisionCache = () => {
  snapshot = null;
};
