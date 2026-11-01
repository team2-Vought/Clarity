import { describe, expect, it } from 'vitest';
import { looksLikeCrisis } from './safety';

describe('looksLikeCrisis', () => {
  it('does not stop ordinary questions that share words with a crisis', () => {
    [
      'Не хочу жити з батьками, чи орендувати квартиру?',
      'Не хочу більше жити в Харкові — переїжджати?',
      'Will I hurt myself financially if I quit?',
      'Should I invest in a suicide-prevention startup?',
      'Чи йти волонтером у профілактику самогубств?',
    ].forEach((question) => expect(looksLikeCrisis(question), question).toBe(false));
  });

  it('still recognises a crisis', () => {
    ['Я не хочу жити', 'Не хочу більше жити, все погано', 'I want to hurt myself.', 'думаю про суїцид']
      .forEach((text) => expect(looksLikeCrisis(text), text).toBe(true));
  });
});
