// Музика ліфта, поки AI-учасники сперечаються: м'яка босанова, зіграна прямо
// в браузері (Web Audio) — без аудіофайлів. Мелодія власна, цикл на 8 тактів.
//
// Стан: `enabled` — увімкнено в налаштуваннях (цей пристрій), `muted` — вимкнено
// динаміком на сайдбарі, `active` — зараз іде дискусія. Грає, коли enabled && !muted && active.

const ENABLED_KEY = 'clarity:elevator-music';
const MUTED_KEY = 'clarity:elevator-muted';

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key, on) => {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // без сховища вибір діє до перезавантаження
  }
};

// ---- партитура ----

const BPM = 92;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const VOLUME = 0.16;
const DUCKED = 0.05; // тихіше, поки репліку читають уголос

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// акорди: бас (корінь, квінта) і голоси електропіано
const CHORDS = [
  { bass: [36, 43], keys: [60, 64, 67, 71] }, // Cmaj7
  { bass: [33, 40], keys: [57, 60, 64, 67] }, // Am7
  { bass: [38, 45], keys: [57, 60, 62, 65] }, // Dm7
  { bass: [31, 38], keys: [55, 59, 62, 65] }, // G7
  { bass: [40, 47], keys: [55, 59, 62, 64] }, // Em7
  { bass: [33, 40], keys: [55, 57, 61, 64] }, // A7
  { bass: [38, 45], keys: [57, 60, 62, 65] }, // Dm7
  { bass: [31, 38], keys: [53, 59, 62, 65] }, // G7
];

// мелодія вібрафона: [доля такту, нота, тривалість у долях]
const MELODY = [
  [[0, 76, 1], [1, 79, 0.5], [1.5, 83, 1.5], [3, 81, 1]],
  [[0.5, 79, 0.5], [1, 76, 1], [2, 72, 1], [3, 74, 1]],
  [[0, 77, 1.5], [1.5, 76, 0.5], [2, 74, 1], [3, 72, 1]],
  [[0, 71, 2], [2.5, 74, 0.5], [3, 77, 1]],
  [[0, 79, 1], [1, 83, 0.5], [1.5, 86, 1.5], [3, 83, 1]],
  [[0, 85, 1.5], [1.5, 83, 0.5], [2, 81, 1], [3, 79, 1]],
  [[0, 77, 1], [1, 81, 1], [2, 84, 1], [3, 81, 0.5], [3.5, 77, 0.5]],
  [[0, 79, 2], [2, 77, 0.5], [2.5, 74, 0.5], [3, 71, 1]],
];

// босанова: акорд піано і бас — на ці долі такту
const COMP = [0, 1.5, 3];
const BASS = [[0, 0, 1.4], [1.5, 1, 0.5], [2, 0, 1.4], [3.5, 1, 0.5]];

// ---- синтезатор ----

let ctx = null;
let nodes = null;
let timer = null;
let nextBar = 0;
let barIndex = 0;

function impulse(context, seconds = 2) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}

function build() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return false;
  ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = 0;
  // динамік ліфта: трохи приглушені верхи
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 3200;
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.28;
  master.connect(tone);
  tone.connect(ctx.destination);
  tone.connect(reverb);
  reverb.connect(wet);
  wet.connect(ctx.destination);

  // тремоло електропіано
  const keys = ctx.createGain();
  keys.gain.value = 0.8;
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  lfo.frequency.value = 4.6;
  depth.gain.value = 0.18;
  lfo.connect(depth);
  depth.connect(keys.gain);
  lfo.start();
  keys.connect(master);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

  nodes = { master, keys, noise };
  return true;
}

function envelope(gain, at, peak, attack, release) {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
}

function voice(freq, at, { type = 'sine', peak, attack, release, out, partial }) {
  const gain = ctx.createGain();
  envelope(gain, at, peak, attack, release);
  gain.connect(out);
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  osc.start(at);
  osc.stop(at + attack + release + 0.05);
  if (partial) {
    // дзвінкий обертон — «молоточок» електропіано чи пластина вібрафона
    const bell = ctx.createOscillator();
    const bellGain = ctx.createGain();
    bell.frequency.value = freq * partial;
    envelope(bellGain, at, peak * 0.22, 0.004, release * 0.35);
    bell.connect(bellGain);
    bellGain.connect(out);
    bell.start(at);
    bell.stop(at + release);
  }
}

function shaker(at, accent) {
  const src = ctx.createBufferSource();
  src.buffer = nodes.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7000;
  const gain = ctx.createGain();
  envelope(gain, at, accent ? 0.05 : 0.025, 0.004, 0.07);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(nodes.master);
  src.start(at);
  src.stop(at + 0.12);
}

function scheduleBar(start, index) {
  const chord = CHORDS[index % CHORDS.length];
  for (const beat of COMP) {
    chord.keys.forEach((note, i) =>
      voice(hz(note), start + beat * BEAT + i * 0.012, {
        peak: 0.07,
        attack: 0.01,
        release: beat === 3 ? 1.1 : 1.4,
        out: nodes.keys,
        partial: 3,
      })
    );
  }
  for (const [beat, which, length] of BASS) {
    voice(hz(chord.bass[which]), start + beat * BEAT, {
      type: 'triangle',
      peak: 0.32,
      attack: 0.015,
      release: length * BEAT,
      out: nodes.master,
    });
  }
  // мелодія — через цикл: раз зі співом вібрафона, раз лише супровід
  if (Math.floor(index / CHORDS.length) % 2 === 0) {
    for (const [beat, note, length] of MELODY[index % MELODY.length]) {
      voice(hz(note), start + beat * BEAT, {
        peak: 0.11,
        attack: 0.006,
        release: Math.max(0.5, length * BEAT * 1.6),
        out: nodes.master,
        partial: 4,
      });
    }
  }
  for (let eighth = 0; eighth < 8; eighth += 1) shaker(start + eighth * BEAT * 0.5, eighth % 2 === 0);
}

function tick() {
  while (nextBar < ctx.currentTime + 0.6) {
    scheduleBar(nextBar, barIndex);
    nextBar += BAR;
    barIndex += 1;
  }
}

function fadeTo(value, seconds) {
  const gain = nodes.master.gain;
  gain.cancelScheduledValues(ctx.currentTime);
  gain.setValueAtTime(gain.value, ctx.currentTime);
  gain.linearRampToValueAtTime(value, ctx.currentTime + seconds);
}

function play() {
  if (!ctx && !build()) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (!timer) {
    nextBar = ctx.currentTime + 0.1;
    barIndex = 0;
    tick();
    timer = window.setInterval(tick, 200);
  }
  fadeTo(state.ducked ? DUCKED : VOLUME, 1.2);
}

function pause() {
  if (!ctx || !timer) return;
  fadeTo(0, 0.6);
  window.clearInterval(timer);
  timer = null;
  window.setTimeout(() => {
    if (!timer) ctx.suspend().catch(() => {});
  }, 1600);
}

// ---- стан ----

const state = {
  enabled: read(ENABLED_KEY) === '1',
  muted: read(MUTED_KEY) === '1',
  active: false,
  ducked: false,
};
let snapshot = { ...state, playing: false };
const listeners = new Set();

export const canPlayMusic = () =>
  typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);

function update(patch) {
  Object.assign(state, patch);
  const playing = canPlayMusic() && state.enabled && !state.muted && state.active;
  if (playing && !snapshot.playing) play();
  else if (!playing && snapshot.playing) pause();
  else if (playing && 'ducked' in patch) fadeTo(state.ducked ? DUCKED : VOLUME, 0.4);
  snapshot = { ...state, playing };
  listeners.forEach((fn) => fn());
}

// браузер не дає звуку грати без дії людини: перший клік «розморожує» його
if (typeof window !== 'undefined') {
  const unlock = () => {
    if (ctx?.state === 'suspended' && timer) ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

export const elevatorMusic = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot: () => snapshot,
  /** Налаштування: показувати динамік і грати під час дискусії. */
  setEnabled(on) {
    write(ENABLED_KEY, on);
    // щойно увімкнули в налаштуваннях — звук не вимкнений
    if (on) write(MUTED_KEY, false);
    update(on ? { enabled: true, muted: false } : { enabled: false });
  },
  /** Динамік на сайдбарі. */
  toggleMuted() {
    write(MUTED_KEY, !state.muted);
    update({ muted: !state.muted });
  },
  /** Дискусія зараз триває (ставить сторінка чату). */
  setActive(on) {
    if (on !== state.active) update({ active: on });
  },
  /** Тихіше, поки репліку читають уголос. */
  setDucked(on) {
    if (on !== state.ducked) update({ ducked: on });
  },
};
