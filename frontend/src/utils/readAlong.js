// Підсвітка рядка, який зараз читають уголос. Через CSS Custom Highlight API —
// розмітку репліки не чіпаємо (як і позначки в marks.js).
//
// AI-голос не каже, коли звучить яке слово, тож місце оцінюємо: час ділиться між
// словами за їхньою довжиною, а після розділових знаків — пауза.

const NAME = 'clarity-reading';
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
// номери джерел [1] не читаються вголос
const SKIP = '.chat__cite, [aria-hidden="true"]';

export const canHighlight = () =>
  typeof CSS !== 'undefined' && Boolean(CSS.highlights) && typeof window.Highlight !== 'undefined';

/** Слова контейнера з «вагою» — скільки часу на них припадає. Позиція — середина слова, 0…1. */
export function wordsOf(element) {
  const words = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let chars = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.data;
    for (const match of text.matchAll(WORD)) {
      const end = match.index + match[0].length;
      const after = text.slice(end, end + 3);
      const pause = /^\s*[.!?…]/.test(after) ? 6 : /^\s*[,;:—–]/.test(after) ? 3 : 0;
      words.push({ node, start: match.index, end, weight: match[0].length + 1 + pause });
    }
    chars += text.length;
  }
  const total = words.reduce((sum, word) => sum + word.weight, 0) || 1;
  let before = 0;
  for (const word of words) {
    word.from = before / total;
    before += word.weight;
    word.to = before / total;
  }
  return { words, chars };
}

/** Індекс слова, що звучить на частці `fraction` усієї репліки. */
export function wordAt(words, fraction) {
  let lo = 0;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].to <= fraction) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const rangeOf = (word, last = word) => {
  const range = document.createRange();
  range.setStart(word.node, word.start);
  range.setEnd(last.node, last.end);
  return range;
};

// верх слова на екрані: слова з тим самим верхом — один рядок
const topOf = (word) => rangeOf(word).getClientRects()[0]?.top ?? NaN;

/** Межі видимого рядка, на якому стоїть слово index: [перше, останнє]. */
export function lineAround(words, index, top = topOf) {
  const y = top(words[index]);
  const same = (i) => Math.abs(top(words[i]) - y) < 4;
  let first = index;
  let last = index;
  while (first > 0 && same(first - 1)) first -= 1;
  while (last < words.length - 1 && same(last + 1)) last += 1;
  return [first, last];
}

/**
 * Підсвічувати рядки в element, поки getProgress() повертає { fraction, chars }.
 * Повертає stop(). Коли на екрані помітно коротший текст, ніж читається
 * (вигляд «лише головне»), не підсвічуємо — було б не те слово.
 */
export function startReadAlong(element, getProgress) {
  if (!element || !canHighlight()) return () => {};
  let { words, chars } = wordsOf(element);
  let shown = -1; // останнє слово підсвіченого рядка
  let lineStart = 0;
  let frame = 0;

  const tick = () => {
    frame = requestAnimationFrame(tick);
    const progress = getProgress();
    if (!progress || !words.length) return;
    if (chars < progress.chars * 0.6) return;
    // React перемалював репліку — збираємо слова наново
    if (!words[0].node.isConnected) ({ words, chars } = wordsOf(element));
    const index = wordAt(words, progress.fraction);
    // ще на тому самому рядку — нічого не міняємо
    if (!words[index] || (shown >= 0 && index <= shown && index >= lineStart)) return;
    const [first, last] = lineAround(words, index);
    lineStart = first;
    shown = last;
    CSS.highlights.set(NAME, new window.Highlight(rangeOf(words[first], words[last])));
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    CSS.highlights.delete(NAME);
  };
}
