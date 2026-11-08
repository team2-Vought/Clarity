// Виділення в репліках AI: як знайти фрагмент у показаному тексті й підсвітити його.
//
// Фрагмент зберігається як цитата з кількома символами до й після неї
// (як TextQuoteSelector у W3C Web Annotation), а не як позиція в розмітці:
// так він знаходиться, навіть якщо Markdown показали трохи інакше.
// Підсвічує CSS Custom Highlight API — він не змінює DOM, тож не сперечається
// з React за вузли тексту. Де API немає, позначки однаково є в панелі «Мої позначки».

export const HIGHLIGHT_COLORS = ['important', 'agree', 'doubt'];
export const CONTEXT_CHARS = 32;
export const QUOTE_MAX = 1000;

export const supportsHighlights = () =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof globalThis.Highlight === 'function';

const textNodes = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  return nodes;
};

/** Позиція точки (вузол + зсув) у суцільному тексті root. */
export const offsetIn = (root, container, offset) => {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(container, offset);
  return range.toString().length;
};

/**
 * Що саме виділено в root: цитата без пробілів по краях і контекст навколо неї.
 * null — виділення порожнє або виходить за межі root.
 */
export const describeSelection = (root, range) => {
  if (!root || !range || range.collapsed) return null;
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = root.textContent || '';
  let start = offsetIn(root, range.startContainer, range.startOffset);
  let end = offsetIn(root, range.endContainer, range.endOffset);
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  if (end <= start) return null;
  const quote = text.slice(start, end).slice(0, QUOTE_MAX);
  return {
    quote,
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(start + quote.length, start + quote.length + CONTEXT_CHARS),
    start,
    end: start + quote.length,
  };
};

// скільки символів збігається: з кінця (для тексту перед цитатою) чи з початку (після)
const sameTail = (a, b) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
};
const sameHead = (a, b) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
};

/** Де в тексті цитата; з кількох збігів — той, чий контекст схожий найбільше. -1 — немає. */
export const locateQuote = (text, { quote, prefix = '', suffix = '' }) => {
  if (!quote) return -1;
  let best = -1;
  let bestScore = -1;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    const before = text.slice(Math.max(0, at - prefix.length), at);
    const after = text.slice(at + quote.length, at + quote.length + suffix.length);
    const score = sameTail(before, prefix) + sameHead(after, suffix);
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  return best;
};

/** DOM Range для [start, end) суцільного тексту root. */
export const rangeAt = (root, start, end) => {
  let seen = 0;
  let startNode = null;
  let startOffset = 0;
  for (const node of textNodes(root)) {
    const length = node.data.length;
    if (!startNode && start <= seen + length) {
      startNode = node;
      startOffset = start - seen;
    }
    if (startNode && end <= seen + length) {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(node, end - seen);
      return range;
    }
    seen += length;
  }
  return null;
};

/** Діапазони всіх виділень репліки, які вдалося знайти в показаному тексті. */
export const locateHighlights = (root, highlights) => {
  const text = root.textContent || '';
  return (highlights || [])
    .map((highlight) => {
      const start = locateQuote(text, highlight);
      if (start < 0) return null;
      const range = rangeAt(root, start, start + highlight.quote.length);
      return range ? { highlight, start, end: start + highlight.quote.length, range } : null;
    })
    .filter(Boolean);
};

/** Яке виділення під точкою кліку (x, y) у root. */
export const highlightAtPoint = (root, located, x, y) => {
  let container = null;
  let offset = 0;
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    container = position?.offsetNode;
    offset = position?.offset || 0;
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    container = range?.startContainer;
    offset = range?.startOffset || 0;
  }
  if (!container || !root.contains(container)) return null;
  const at = offsetIn(root, container, offset);
  // найкоротше з виділень, що накриває точку, — щоб вкладене можна було відкрити
  return (
    located
      .filter((item) => at >= item.start && at <= item.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0]?.highlight || null
  );
};

// ---- спільна підсвітка: по одному CSS Highlight на кожне значення ----

const registry = new Map();

const repaint = () => {
  if (!supportsHighlights()) return;
  for (const color of HIGHLIGHT_COLORS) {
    const ranges = [];
    registry.forEach((items) => {
      items.forEach((item) => {
        if (item.highlight.color === color) ranges.push(item.range);
      });
    });
    if (ranges.length) CSS.highlights.set(`clarity-${color}`, new globalThis.Highlight(...ranges));
    else CSS.highlights.delete(`clarity-${color}`);
  }
};

/** Репліка оновила свої виділення; порожній список прибирає її з підсвітки. */
export const paintHighlights = (key, located) => {
  if (located?.length) registry.set(key, located);
  else registry.delete(key);
  repaint();
};

/** Короткий текст цитати для полів і підказок. */
export const shortQuote = (quote, limit = 120) => {
  const text = String(quote || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};
