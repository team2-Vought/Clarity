// Налаштування цього пристрою (не акаунта): як надсилати повідомлення,
// чи зменшувати анімацію й чи показувати приклади запитів. Тема живе окремо — її ключ читає ще index.html.

export const THEME_KEY = 'clarity-theme';
const SEND_KEY = 'clarity:send-key';
const MOTION_KEY = 'clarity:motion';
const SUGGESTIONS_KEY = 'clarity:suggestions';

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key, value) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // без сховища налаштування діє до перезавантаження
  }
};

/** 'light' | 'dark' | 'system' */
export const readThemeMode = () => {
  const saved = read(THEME_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
};

export const writeThemeMode = (mode) => write(THEME_KEY, mode);

/** 'enter' — Enter надсилає, Shift + Enter — новий рядок; 'mod-enter' — навпаки, Ctrl/⌘ + Enter. */
export const readSendKey = () => (read(SEND_KEY) === 'mod-enter' ? 'mod-enter' : 'enter');

export const writeSendKey = (value) => write(SEND_KEY, value === 'mod-enter' ? value : '');

/** Чи це натискання має надіслати повідомлення з поля вводу. */
export const isSendShortcut = (e) => {
  if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return false;
  if (readSendKey() === 'mod-enter') return e.metaKey || e.ctrlKey;
  return !e.shiftKey;
};

export const readReducedMotion = () => read(MOTION_KEY) === 'reduced';

export const writeReducedMotion = (reduced) => {
  write(MOTION_KEY, reduced ? 'reduced' : '');
  if (reduced) document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
};

/** Приклади запитів під полем нової дискусії; за замовчуванням увімкнені. */
export const readSuggestions = () => read(SUGGESTIONS_KEY) !== 'off';

export const writeSuggestions = (on) => write(SUGGESTIONS_KEY, on ? '' : 'off');

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
