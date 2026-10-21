// Невеликий markdown для реплік: лише те, що дозволено моделям у промпті —
// абзаци, заголовки, списки, цитати, розділювачі та інлайн-виділення.
// HTML не підтримується: текст завжди рендериться як текст.

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const BULLET_RE = /^[-*•–]\s+(.*)$/;
const ORDERED_RE = /^(\d{1,3})[.)]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
// «Слабкі місця: …» у старих репліках без розмітки — короткий підпис перед двокрапкою
const LABEL_RE = /^([^\n:.!?«»"*_`#[\]]{2,40}):\s+(?=\S)/;

/**
 * Розбиває текст на блоки. Кожен непорожній рядок — окремий абзац (моделі
 * не переносять рядки всередині абзацу), пункти списку поспіль — один список.
 */
export function parseBlocks(content) {
  const blocks = [];
  const lines = String(content || '')
    .replace(/\r\n/g, '\n')
    // деякі моделі ставлять нерозривні пробіли й дефіси між усіма словами —
    // тоді речення не переноситься по словах і рветься посеред слова
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\u2011/g, '-')
    .split('\n');
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const last = blocks[blocks.length - 1];

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', text: heading[2] });
      return;
    }
    if (HR_RE.test(line)) {
      // розділювач на початку чи двічі поспіль нічого не відокремлює
      if (last && last.type !== 'hr') blocks.push({ type: 'hr' });
      return;
    }
    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      if (last?.type === 'ul') last.items.push(bullet[1]);
      else blocks.push({ type: 'ul', items: [bullet[1]] });
      return;
    }
    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      if (last?.type === 'ol') last.items.push(ordered[2]);
      else blocks.push({ type: 'ol', start: Number(ordered[1]), items: [ordered[2]] });
      return;
    }
    const quote = QUOTE_RE.exec(line);
    if (quote) {
      if (last?.type === 'quote') last.lines.push(quote[1]);
      else blocks.push({ type: 'quote', lines: [quote[1]] });
      return;
    }
    const label = LABEL_RE.exec(line);
    if (label) {
      blocks.push({ type: 'p', label: label[1], text: line.slice(label[0].length) });
      return;
    }
    blocks.push({ type: 'p', text: line });
  });
  if (blocks[blocks.length - 1]?.type === 'hr') blocks.pop();
  return blocks;
}

// **жирний**, __жирний__, `код`, [n], [текст](https://…), *курсив*, _курсив_
const INLINE_RE =
  /(\*\*(?=\S)[\s\S]+?\*\*|__(?=\S)[\s\S]+?__|`[^`\n]+`|\[\d+\]|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*(?=[^\s*])[^*\n]+?\*|(?<![\p{L}\d])_(?=[^\s_])[^_\n]+?_(?![\p{L}\d]))/gu;

/** Розбиває рядок на інлайн-токени: { type, text, ... }. */
export function parseInline(text) {
  const tokens = [];
  const source = String(text ?? '');
  let index = 0;
  for (const match of source.matchAll(INLINE_RE)) {
    if (match.index > index) tokens.push({ type: 'text', text: source.slice(index, match.index) });
    const value = match[0];
    if (value.startsWith('**') || value.startsWith('__')) {
      tokens.push({ type: 'strong', text: value.slice(2, -2) });
    } else if (value.startsWith('`')) {
      tokens.push({ type: 'code', text: value.slice(1, -1) });
    } else if (/^\[\d+\]$/.test(value)) {
      tokens.push({ type: 'cite', id: Number(value.slice(1, -1)), text: value });
    } else if (value.startsWith('[')) {
      const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(value);
      tokens.push({ type: 'link', text: label, url });
    } else {
      tokens.push({ type: 'em', text: value.slice(1, -1) });
    }
    index = match.index + value.length;
  }
  if (index < source.length) tokens.push({ type: 'text', text: source.slice(index) });
  return tokens;
}

/** Номери джерел, на які посилається текст: [2], [5]. */
export function citedIds(content) {
  return [...String(content || '').matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
}

/** Текст без розмітки — для копіювання в месенджер чи нотатки. */
export function plainText(content) {
  return parseBlocks(content)
    .map((block) => {
      const strip = (value) =>
        parseInline(value)
          .map((token) => (token.type === 'link' ? `${token.text} (${token.url})` : token.text))
          .join('');
      switch (block.type) {
        case 'heading':
          return strip(block.text).toUpperCase();
        case 'hr':
          return '—';
        case 'ul':
          return block.items.map((item) => `• ${strip(item)}`).join('\n');
        case 'ol':
          return block.items.map((item, i) => `${block.start + i}. ${strip(item)}`).join('\n');
        case 'quote':
          return block.lines.map((line) => `«${strip(line)}»`).join('\n');
        default:
          return block.label ? `${block.label}: ${strip(block.text)}` : strip(block.text);
      }
    })
    .join('\n\n');
}

/** Скільки слів у блоці — від цього залежить пауза перед його появою. */
export function blockWords(block) {
  const text =
    block.type === 'ul' || block.type === 'ol'
      ? block.items.join(' ')
      : block.type === 'quote'
        ? block.lines.join(' ')
        : `${block.label || ''} ${block.text || ''}`;
  return text.split(/\s+/).filter(Boolean).length;
}
