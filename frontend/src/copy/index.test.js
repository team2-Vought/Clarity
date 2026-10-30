import { afterEach, describe, expect, it } from 'vitest';
import { deviceLanguage } from './index';
import { en } from './en';
import { uk } from './uk';

const setLanguages = (languages) =>
  Object.defineProperty(navigator, 'languages', { value: languages, configurable: true });

describe('deviceLanguage', () => {
  afterEach(() => setLanguages(['uk-UA']));

  it('бере першу підтримувану мову зі списку пристрою', () => {
    setLanguages(['de-DE', 'uk-UA', 'en-US']);
    expect(deviceLanguage()).toBe('uk');
    setLanguages(['en-GB', 'uk']);
    expect(deviceLanguage()).toBe('en');
  });

  it('без української чи англійської — англійська', () => {
    setLanguages(['de-DE', 'fr']);
    expect(deviceLanguage()).toBe('en');
  });
});

describe('словники', () => {
  const shape = (value) => {
    if (Array.isArray(value)) return value.map(shape);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]));
    }
    return typeof value;
  };

  it('англійський має ті самі ключі, що й український', () => {
    expect(shape(en)).toEqual(shape(uk));
  });
});
