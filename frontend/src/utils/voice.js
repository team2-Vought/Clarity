// Голос у браузері (Web Speech API), без сервера:
// озвучення реплік — кожен учасник своїм голосом і тембром — і диктування питання.
// Де браузер не вміє (Firefox без розпізнавання, вбудовані WebView), кнопок просто немає.

// Характер чути з тембру: Скептик нижчий і повільніший, Креатив вищий і жвавіший,
// AI Devil — низький і розмірений. Решта (власні ролі) — за хешем імені.
const TONES = {
  moderator: { pitch: 1, rate: 1 },
  devil: { pitch: 0.55, rate: 0.92 },
  logician: { pitch: 0.92, rate: 1 },
  empath: { pitch: 1.15, rate: 0.96 },
  skeptic: { pitch: 0.78, rate: 0.98 },
  pragmatist: { pitch: 1, rate: 1.1 },
  creative: { pitch: 1.3, rate: 1.08 },
};

const hash = (text) => {
  let h = 0;
  for (const ch of String(text || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
};

const synth = () => (typeof window !== 'undefined' ? window.speechSynthesis : null);

export const canSpeak = () =>
  Boolean(synth()) && typeof window.SpeechSynthesisUtterance !== 'undefined';

const Recognition = () =>
  typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null;

export const canDictate = () => Boolean(Recognition());

export function toneFor(key) {
  if (TONES[key]) return TONES[key];
  const h = hash(key);
  return { pitch: 0.8 + (h % 50) / 100, rate: 0.94 + ((h >> 6) % 16) / 100 };
}

/** Голоси мови інтерфейсу; якщо таких немає — усі, щоб хоч щось прозвучало. */
function voicesFor(lang) {
  const all = synth()?.getVoices?.() || [];
  const own = all.filter((v) => v.lang?.toLowerCase().startsWith(lang));
  return [...own].sort((a, b) => a.name.localeCompare(b.name));
}

/** Сталий голос для учасника: той самий у всій дискусії й на кожному пристрої з тими ж голосами. */
export function voiceFor(key, lang) {
  const voices = voicesFor(lang);
  if (!voices.length) return null;
  // модератор — «головний» голос мови, решта розходяться по інших
  if (key === 'moderator') return voices.find((v) => v.default) || voices[0];
  return voices[hash(key) % voices.length];
}

/** Markdown репліки → текст для читання вголос: без посилань-цифр, зірочок і решіток. */
export function plainText(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Chrome обриває довгі фрази приблизно після 15 секунд — читаємо реченнями
function chunks(text, max = 220) {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  const out = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length > max && current) {
      out.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function sayChunk(text, { voice, tone, lang }) {
  return new Promise((resolve) => {
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang || (lang === 'en' ? 'en-US' : 'uk-UA');
    if (voice) utterance.voice = voice;
    utterance.pitch = tone.pitch;
    utterance.rate = tone.rate;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synth().speak(utterance);
  });
}

/**
 * Черга озвучення: репліки звучать по черзі, кожна своїм голосом.
 * stop() обриває поточну й скасовує решту.
 */
export function createSpeaker(lang) {
  let queue = Promise.resolve();
  let generation = 0;
  let current = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(current));

  return {
    /** key — роль чи slug учасника (тембр), id — щоб показати, хто зараз говорить. */
    say(markdown, { key, id = null } = {}) {
      if (!canSpeak()) return Promise.resolve();
      const text = plainText(markdown);
      if (!text) return Promise.resolve();
      const mine = generation;
      queue = queue.then(async () => {
        if (mine !== generation) return;
        current = id;
        emit();
        const voice = voiceFor(key, lang);
        const tone = toneFor(key);
        for (const part of chunks(text)) {
          if (mine !== generation) break;
          await sayChunk(part, { voice, tone, lang });
        }
        if (mine === generation) {
          current = null;
          emit();
        }
      });
      return queue;
    },
    stop() {
      generation += 1;
      queue = Promise.resolve();
      current = null;
      synth()?.cancel();
      emit();
    },
    /** fn(id | null) — хто зараз говорить. Повертає відписку. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * Диктування: onText(текст) з кожною готовою фразою. Повертає stop().
 * onEnd — розпізнавання закінчилось (тиша, помилка, дозвіл не дали).
 */
export function dictate({ lang, onText, onEnd }) {
  const Ctor = Recognition();
  if (!Ctor) return () => {};
  const recognition = new Ctor();
  recognition.lang = lang === 'en' ? 'en-US' : 'uk-UA';
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (event.results[i].isFinal) onText(event.results[i][0].transcript.trim());
    }
  };
  recognition.onerror = (event) => onEnd?.(event.error);
  recognition.onend = () => onEnd?.();
  try {
    recognition.start();
  } catch {
    onEnd?.('start');
  }
  return () => {
    try {
      recognition.stop();
    } catch {
      /* уже зупинено */
    }
  };
}
