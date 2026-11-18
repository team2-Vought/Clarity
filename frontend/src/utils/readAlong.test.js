// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { lineAround, wordAt, wordsOf } from './readAlong';

describe('readAlong', () => {
  it('splits a reply into words, skipping source numbers', () => {
    const el = document.createElement('div');
    el.innerHTML = 'Оренда дає гнучкість<sup class="chat__cite">1</sup>. Купівля — ні.';
    expect(wordsOf(el).words.map((w) => w.node.data.slice(w.start, w.end))).toEqual([
      'Оренда', 'дає', 'гнучкість', 'Купівля', 'ні',
    ]);
  });

  it('finds the word that sounds at a given point', () => {
    const el = document.createElement('div');
    el.textContent = 'раз два три';
    const { words } = wordsOf(el);
    expect(wordAt(words, 0)).toBe(0);
    expect(wordAt(words, 0.5)).toBe(1);
    expect(wordAt(words, 0.99)).toBe(2);
  });

  it('grows the highlight to the whole visual line of the current word', () => {
    const el = document.createElement('div');
    el.textContent = 'один два три чотири пʼять';
    const { words } = wordsOf(el);
    // перші три слова — на першому рядку, решта — на другому
    const top = (word) => (words.indexOf(word) < 3 ? 0 : 24);
    expect(lineAround(words, 1, top)).toEqual([0, 2]);
    expect(lineAround(words, 4, top)).toEqual([3, 4]);
  });
});
