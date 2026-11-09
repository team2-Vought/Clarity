// Сповіщення про те, що дискусія дійшла до кінця чи чекає на людину.
// Налаштування — цього пристрою: звук увімкнено за замовчуванням, системні
// сповіщення — лише після дозволу браузера. Людина могла піти з вкладки,
// поки AI думають, тож Clarity кличе її назад звуком і сповіщенням.

const SOUND_KEY = 'clarity:sound';
const NOTIFY_KEY = 'clarity:notify';
// людина вже відповіла на пропозицію в чаті — більше не питаємо
const ASKED_KEY = 'clarity:notify-asked';
export const NOTIFY_PREFS_EVENT = 'clarity:notify-prefs';

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
  // сайдбар і налаштування показують той самий стан — оновлюємо всіх
  window.dispatchEvent(new Event(NOTIFY_PREFS_EVENT));
};

export const readSound = () => read(SOUND_KEY) !== 'off';

export const writeSound = (on) => write(SOUND_KEY, on ? '' : 'off');

export const notificationsSupported = () =>
  typeof window !== 'undefined' && 'Notification' in window;

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export const notificationPermission = () =>
  notificationsSupported() ? window.Notification.permission : 'unsupported';

export const readSystemNotify = () =>
  read(NOTIFY_KEY) === 'on' && notificationPermission() === 'granted';

export const writeSystemNotify = (on) => write(NOTIFY_KEY, on ? 'on' : '');

export const readNotifyAsked = () => read(ASKED_KEY) === '1';

export const writeNotifyAsked = () => write(ASKED_KEY, '1');

/** Просить дозвіл (лише у відповідь на дію людини) і вмикає сповіщення. */
export async function enableSystemNotify() {
  if (!notificationsSupported()) return 'unsupported';
  let permission = window.Notification.permission;
  if (permission === 'default') {
    try {
      permission = await window.Notification.requestPermission();
    } catch {
      permission = 'denied';
    }
  }
  writeSystemNotify(permission === 'granted');
  return permission;
}

let audio;

/** Два м'які тони вгору — коротко й не різко, без звукових файлів. */
export function playChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const start = audio.currentTime + 0.02;
    [659.25, 987.77].forEach((frequency, index) => {
      const at = start + index * 0.14;
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.type = 'sine';
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      tone.connect(gain).connect(audio.destination);
      tone.start(at);
      tone.stop(at + 0.5);
    });
  } catch {
    // звук — лише підказка: без нього лишаються сповіщення й позначка у вкладці
  }
}

/** Людина зараз не дивиться на сторінку: інша вкладка чи інше вікно. */
export const isAway = () =>
  document.visibilityState === 'hidden' || !document.hasFocus();

/** Звук і системне сповіщення — кожне, якщо людина його не вимкнула. */
export function alertUser({ title, body, tag, onClick }) {
  if (readSound()) playChime();
  if (!readSystemNotify()) return;
  try {
    const notification = new window.Notification(title, {
      body,
      tag,
      icon: '/apple-touch-icon.png',
    });
    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
  } catch {
    // деякі браузери (Android Chrome) дозволяють сповіщення лише з service worker
  }
}
