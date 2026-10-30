// Мова інтерфейсу: вибір у налаштуваннях або мова пристрою.
// Визначається один раз під час завантаження — тексти читаються ще на рівні
// модулів (`const t = copy.chat`), тож зміна мови перезавантажує сторінку.

import { en } from './en';
import { uk } from './uk';

export const LANGUAGES = ['uk', 'en'];
const LANG_KEY = 'clarity:lang';

const read = () => {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
};

/** 'uk' | 'en' | 'system' — що обрано в налаштуваннях. */
export const readLanguagePref = () => {
  const saved = read();
  return LANGUAGES.includes(saved) ? saved : 'system';
};

/** Перша з підтримуваних мов у списку мов пристрою; інакше — англійська. */
export const deviceLanguage = () => {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const list = nav?.languages?.length ? nav.languages : [nav?.language];
  for (const item of list) {
    const code = String(item || '').toLowerCase().slice(0, 2);
    if (LANGUAGES.includes(code)) return code;
  }
  return 'en';
};

const pref = readLanguagePref();

export const lang = pref === 'system' ? deviceLanguage() : pref;
export const copy = lang === 'en' ? en : uk;
/** Локаль для дат і чисел. */
export const locale = lang === 'en' ? 'en-US' : 'uk-UA';

if (typeof document !== 'undefined') document.documentElement.lang = lang;

/** Зберігає вибір і перезавантажує сторінку, якщо мова справді змінилась. */
export const setLanguagePref = (value) => {
  try {
    if (LANGUAGES.includes(value)) localStorage.setItem(LANG_KEY, value);
    else localStorage.removeItem(LANG_KEY);
  } catch {
    // без сховища вибір діятиме лише до перезавантаження — тож і не перезавантажуємо
    return;
  }
  const next = LANGUAGES.includes(value) ? value : deviceLanguage();
  if (next !== lang) window.location.reload();
};
