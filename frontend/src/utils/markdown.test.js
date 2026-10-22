import { describe, expect, it } from 'vitest';
import { inlinePlain, parseBlocks, parseInline } from './markdown';

describe('parseBlocks', () => {
  it('розрізняє рівні заголовків', () => {
    const blocks = parseBlocks('## Частина\n### Підпис\nТекст');
    expect(blocks.map((block) => [block.type, block.level])).toEqual([
      ['heading', 2],
      ['heading', 3],
      ['p', undefined],
    ]);
  });
});

describe('parseInline', () => {
  it('розпізнає жирний, курсив і закреслення', () => {
    const types = parseInline('**так**, *курсив* і ~~ні~~').map((token) => token.type);
    expect(types).toEqual(['strong', 'text', 'em', 'text', 'del']);
  });
});

describe('inlinePlain', () => {
  it('знімає розмітку, зокрема вкладену', () => {
    expect(inlinePlain('**важливо, *дуже* важливо** і ~~ні~~')).toBe('важливо, дуже важливо і ні');
  });
});
