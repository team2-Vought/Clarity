// Мала заміна `animate` з бібліотеки motion на вбудованому Web Animations API
// (бібліотека важила ~26 КБ gzip лише заради цієї функції). Виклик той самий:
// `animate(el, { opacity: [від, до] | до }, { duration, ease, repeat, delay })`,
// у відповідь — `stop()` і `then()`. Як і в motion, кінцеве значення лишається
// в style елемента, тож наступна анімація стартує з нього, а не з CSS.

const easing = (ease) => (Array.isArray(ease) ? `cubic-bezier(${ease.join(', ')})` : ease || 'ease');

// значення, на якому анімацію зупинили чи завершили, переносимо в style
const commit = (animation) => {
  try {
    animation.commitStyles();
  } catch {
    // елемент уже не на сторінці — зберігати нічого
  }
  animation.cancel();
};

export function animate(el, keyframes, { duration = 0.3, ease, repeat = 0, delay = 0 } = {}) {
  if (typeof el.animate !== 'function') {
    // без WAAPI (jsdom у тестах) — одразу кінцевий стан
    Object.entries(keyframes).forEach(([key, value]) => {
      el.style[key] = Array.isArray(value) ? value[value.length - 1] : value;
    });
    return { stop() {}, then: (resolve) => Promise.resolve().then(resolve) };
  }
  const animation = el.animate(keyframes, {
    duration: duration * 1000,
    delay: delay * 1000,
    easing: easing(ease),
    iterations: repeat === Infinity ? Infinity : repeat + 1,
    fill: 'forwards',
  });
  let stopped = false;
  // перервана анімація не завершується ніколи — як і в motion
  const finished = animation.finished.then(
    () => {
      if (!stopped) commit(animation);
    },
    () => new Promise(() => {})
  );
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      commit(animation);
    },
    then: (resolve, reject) => finished.then(resolve, reject),
  };
}

/** Системне «зменшити рух» або «Менше анімації» в налаштуваннях застосунку. */
export const prefersReducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced'
  || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
