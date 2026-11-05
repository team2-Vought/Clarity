// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { describeSelection, locateHighlights, locateQuote, rangeAt, shortQuote } from './highlights';
import { markEntries, marksMarkdown, patchMessage } from './marks';

const mount = (html) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
};

describe('прив’язка виділення до тексту', () => {
  it('описує виділення без пробілів по краях і з контекстом', () => {
    const root = mount('<p>Зарплата вища, <strong>але оренда</strong> з’їсть різницю.</p>');
    const range = rangeAt(root, 14, 26);
    const info = describeSelection(root, range);
    expect(info.quote).toBe('але оренда');
    expect(info.prefix.endsWith('вища, ')).toBe(true);
    expect(info.suffix.startsWith(' з’їсть')).toBe(true);
  });

  it('з кількох збігів обирає той, чий контекст схожий', () => {
    const text = 'ризик великий. Інший ризик малий.';
    expect(locateQuote(text, { quote: 'ризик', prefix: 'Інший ', suffix: ' малий' })).toBe(21);
    expect(locateQuote(text, { quote: 'ризик', prefix: '', suffix: ' великий' })).toBe(0);
    expect(locateQuote(text, { quote: 'немає' })).toBe(-1);
  });

  it('знаходить діапазон через кілька вузлів тексту', () => {
    const root = mount('<p>один <em>два</em> три</p>');
    const [item] = locateHighlights(root, [{ id: 'h', quote: 'два три', prefix: 'один ', suffix: '' }]);
    expect(item.range.toString()).toBe('два три');
    expect(item.start).toBe(5);
  });

  it('виділення, якого вже немає в тексті, просто пропускається', () => {
    const root = mount('<p>інший текст</p>');
    expect(locateHighlights(root, [{ id: 'h', quote: 'оренда' }])).toEqual([]);
  });

  it('скорочує довгу цитату', () => {
    expect(shortQuote('а  б\nв', 10)).toBe('а б в');
    expect(shortQuote('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('конспект позначок', () => {
  const messages = [
    { id: '1', role: 'user', content: 'Питання' },
    { id: '2', role: 'ai', persona_name: 'Логік', reaction: 'convincing', highlights: [] },
    {
      id: '3',
      role: 'ai',
      persona_name: 'Скептик',
      reaction: '',
      highlights: [{ id: 'h', quote: 'оренда  з’їсть', color: 'doubt', note: 'перевірити' }],
    },
  ];

  it('збирає лише репліки з позначками', () => {
    const entries = markEntries(messages, (message) => message.persona_name);
    expect(entries.map((entry) => entry.message.id)).toEqual(['2', '3']);
  });

  it('пише Markdown з реакціями, цитатами й нотатками', () => {
    const text = marksMarkdown(markEntries(messages, (message) => message.persona_name));
    expect(text).toContain('## Мої позначки');
    expect(text).toContain('**Логік** — Переконливо');
    expect(text).toContain('> оренда з’їсть');
    expect(text).toContain('*Сумнів*: перевірити');
    expect(marksMarkdown([])).toBe('');
  });

  it('оновлює одне повідомлення, не чіпаючи інших', () => {
    const next = patchMessage(messages, '2', () => ({ reaction: 'wrong' }));
    expect(next[1].reaction).toBe('wrong');
    expect(next[2]).toBe(messages[2]);
  });
});
