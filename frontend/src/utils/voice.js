// Голос: озвучення реплік — кожен учасник своїм голосом (AI-голос із сервера,
// а без нього — Web Speech API браузера) — і диктування питання.
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

function sayChunk(text, { voice, tone, lang, onBoundary }) {
  return new Promise((resolve) => {
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang || (lang === 'en' ? 'en-US' : 'uk-UA');
    if (voice) utterance.voice = voice;
    utterance.pitch = tone.pitch;
    utterance.rate = tone.rate;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    // браузер сам каже, з якого символу почалось слово — підсвітка йде точно
    utterance.onboundary = (event) => onBoundary?.(event.charIndex);
    synth().speak(utterance);
  });
}

// ---- AI-голос: репліку читає модель мовлення на сервері (/api/tts/) ----

// одна репліка — один запит: безкоштовний ключ Gemini дає ~10 озвучень на день на модель
const AI_CHUNK = 1500;

let aiState = 'unknown'; // 'unknown' | 'on' | 'off' (сервер без ключа — до перезавантаження браузерний голос)
const audioCache = new Map(); // `${key}|${text}` -> Promise<AudioBuffer | null>
const AUDIO_CACHE = 12;

// Звук граємо через Web Audio, а не <audio>: Safari блокує audio.play() після
// очікування мережі (жест кліку вже «вичерпався»), а AudioContext, розблокований
// у самому кліку, далі грає будь-коли.
let audioCtx = null;
const audioContext = () => {
  if (audioCtx) return audioCtx;
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
};

const canPlayAudio = () =>
  typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);

/** Викликати синхронно в обробнику кліку — тоді AI-голос зможе зазвучати пізніше. */
export function unlockAudio() {
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  try {
    // Safari «запам'ятовує» дозвіл, лише коли в жесті справді щось зазвучало
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    /* немає звуку — не страшно */
  }
}

// озвучення нових реплік вмикається й після перезавантаження — тоді звук
// розблоковує перший же клік чи клавіша на сторінці
if (canPlayAudio()) {
  const unlockOnce = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', unlockOnce, true);
    window.removeEventListener('keydown', unlockOnce, true);
  };
  window.addEventListener('pointerdown', unlockOnce, true);
  window.addEventListener('keydown', unlockOnce, true);
}

const aiChunks = (text) => chunks(text, AI_CHUNK);

const decode = (ctx, bytes) =>
  new Promise((resolve, reject) => {
    // старий Safari знає лише форму з колбеками
    const result = ctx.decodeAudioData(bytes, resolve, reject);
    if (result?.then) result.then(resolve, reject);
  });

async function loadAudio(text, key) {
  const { fetchSpeech } = await import('../api/tts');
  const blob = await fetchSpeech(text, key);
  return decode(audioContext(), await blob.arrayBuffer());
}

/** Озвучений шматок (з кешу, якщо вже був) або null. */
function aiAudio(text, key) {
  if (aiState === 'off' || !canPlayAudio()) return Promise.resolve(null);
  const cacheKey = `${key}|${text}`;
  if (!audioCache.has(cacheKey)) {
    const pending = loadAudio(text, key).then(
      (buffer) => {
        aiState = 'on';
        return buffer;
      },
      (err) => {
        audioCache.delete(cacheKey);
        // 503 — на сервері немає ключа Gemini; 429 — денний ліміт озвучень вичерпано;
        // 401/403 — не увійшли. До перезавантаження — браузерний голос
        if ([401, 403, 404, 429, 503].includes(err?.status)) aiState = 'off';
        return null;
      }
    );
    audioCache.set(cacheKey, pending);
    while (audioCache.size > AUDIO_CACHE) audioCache.delete(audioCache.keys().next().value);
  }
  return audioCache.get(cacheKey);
}

let playing = null; // { source, finish, startedAt, duration }

/** Яку частку поточного шматка AI-голосу вже прозвучало (0…1), або null. */
function audioProgress() {
  if (!playing || !audioCtx) return null;
  const elapsed = audioCtx.currentTime - playing.startedAt;
  return Math.min(1, Math.max(0, elapsed / playing.duration));
}

function playBuffer(buffer) {
  const ctx = audioContext();
  if (!ctx) return Promise.resolve(false);
  return new Promise((resolve) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const finish = (ok) => {
      if (playing?.source === source) playing = null;
      resolve(ok);
    };
    source.onended = () => finish(true);
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    playing = { source, finish, startedAt: ctx.currentTime, duration: buffer.duration || 1 };
    source.start(0);
  });
}

function stopAudio() {
  const current = playing;
  playing = null;
  if (!current) return;
  try {
    current.source.stop();
  } catch {
    /* уже зупинено */
  }
  current.finish(true);
}

/**
 * Черга озвучення: репліки звучать по черзі, кожна своїм голосом.
 * Спершу — AI-голос із сервера; якщо його немає, читає браузер (Web Speech API).
 * stop() обриває поточну й скасовує решту.
 */
export function createSpeaker(lang) {
  let queue = Promise.resolve();
  let generation = 0;
  let current = null;
  let loading = false; // AI-голос ще готується на сервері
  let pending = 0; // реплік у черзі разом із тією, що звучить
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(current, loading, pending > 0));
  const setLoading = (value) => {
    if (loading === value) return;
    loading = value;
    emit();
  };

  // де зараз читання: для підсвітки слів у репліці
  let reading = null; // { id, total, done, part, mode: 'audio' | 'browser', char }

  const sayBrowser = async (part, key, mine) => {
    if (!canSpeak() || mine !== generation) return;
    const onBoundary = (char) => {
      if (reading) reading.char = char;
    };
    await sayChunk(part, { voice: voiceFor(key, lang), tone: toneFor(key), lang, onBoundary });
  };

  return {
    /** key — роль чи slug учасника (голос), id — щоб показати, хто зараз говорить. */
    say(markdown, { key, id = null } = {}) {
      if (!canSpeak() && !canPlayAudio()) return Promise.resolve();
      const text = plainText(markdown);
      if (!text) return Promise.resolve();
      const mine = generation;
      // зайнятий одразу, ще до черги: голосовий режим не покаже наступну репліку завчасно
      pending += 1;
      emit();
      const parts = aiState === 'off' ? chunks(text) : aiChunks(text);
      // перший шматок вантажимо одразу, поки ще звучить попередня репліка
      const first = aiAudio(parts[0], key);
      queue = queue.then(async () => {
        if (mine !== generation) return;
        current = id;
        reading = { id, total: parts.reduce((sum, part) => sum + part.length, 0), done: 0, part: '', mode: 'audio', char: 0 };
        emit();
        let next = first;
        for (let i = 0; i < parts.length; i += 1) {
          if (mine !== generation) break;
          if (aiState !== 'off') setLoading(true);
          let buffer = await next;
          // разовий збій мережі чи моделі — ще одна спроба, а не робоголос посеред репліки
          if (!buffer && aiState !== 'off') buffer = await aiAudio(parts[i], key);
          if (mine !== generation) break;
          setLoading(false);
          // наступний шматок готується, поки звучить цей
          next = i + 1 < parts.length ? aiAudio(parts[i + 1], key) : null;
          Object.assign(reading || {}, { part: parts[i], mode: buffer ? 'audio' : 'browser', char: 0 });
          if (buffer) await playBuffer(buffer);
          else await sayBrowser(parts[i], key, mine);
          if (reading && mine === generation) reading.done += parts[i].length;
        }
        if (mine === generation) {
          pending = Math.max(0, pending - 1);
          if (!pending) {
            current = null;
            reading = null;
            loading = false;
          }
          emit();
        }
      });
      return queue;
    },
    /**
     * Скільки репліки вже прочитано: { id, fraction 0…1, chars — довжина тексту для читання }.
     * Для AI-голосу — оцінка за часом (модель не каже, де яке слово), для браузерного — точно.
     */
    progress() {
      if (!reading || !reading.part) return null;
      const within = reading.mode === 'audio'
        ? (audioProgress() ?? 0) * reading.part.length
        : reading.char;
      return { id: reading.id, fraction: Math.min(1, (reading.done + within) / reading.total), chars: reading.total };
    },
    stop() {
      generation += 1;
      queue = Promise.resolve();
      current = null;
      reading = null;
      loading = false;
      pending = 0;
      stopAudio();
      synth()?.cancel();
      emit();
    },
    /** fn(id | null, loading) — хто зараз говорить і чи його голос ще готується. Повертає відписку. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Чи вміє браузер хоч якось читати вголос (AI-голос чи власний синтез). */
export const canReadAloud = () => canSpeak() || canPlayAudio();

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
