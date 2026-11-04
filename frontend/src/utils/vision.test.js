// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VISION_DEFAULTS,
  VISION_KEY,
  VISION_PRESET,
  applyVision,
  getVision,
  isVisionActive,
  isVisionShortcut,
  resetVisionCache,
  sanitizeVision,
  setVisionMode,
  subscribeVision,
  updateVision,
} from './vision';

const root = document.documentElement;
const stored = () => JSON.parse(localStorage.getItem(VISION_KEY) || 'null');

const mockContrastQuery = (matches) => {
  window.matchMedia = (query) => ({
    matches: query === '(prefers-contrast: more)' ? matches : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
};

describe('режим для слабозорих', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    resetVisionCache();
    mockContrastQuery(false);
    for (const key of Object.keys(root.dataset)) {
      if (key !== 'theme') delete root.dataset[key];
    }
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('без збережених налаштувань — звичайний вигляд', () => {
    expect(sanitizeVision(null)).toEqual(VISION_DEFAULTS);
    expect(isVisionActive(getVision())).toBe(false);
  });

  it('відкидає невідомі й зіпсовані значення', () => {
    const prefs = sanitizeVision({ scale: 300, contrast: 'neon', font: 1, spacing: 'yes', evil: true });
    expect(prefs).toEqual(VISION_DEFAULTS);
    expect(prefs).not.toHaveProperty('evil');
  });

  it('висока контрастність за замовчуванням іде за prefers-contrast ОС', () => {
    mockContrastQuery(true);
    expect(sanitizeVision({}).contrast).toBe('high');
    expect(sanitizeVision({ contrast: 'normal' }).contrast).toBe('normal');
  });

  it('переносить опції на <html> як data-атрибути', () => {
    applyVision({ ...VISION_PRESET, font: 'default' });
    expect(root.dataset).toMatchObject({
      textScale: '150',
      contrast: 'high',
      spacing: 'wide',
      links: 'underline',
      focus: 'strong',
      cursor: 'large',
    });
    expect(root.dataset.font).toBeUndefined();

    applyVision(VISION_DEFAULTS);
    expect(root.dataset.textScale).toBeUndefined();
    expect(root.dataset.contrast).toBeUndefined();
    expect(root.dataset.cursor).toBeUndefined();
  });

  it('головний перемикач вмикає весь набір і «Менше анімації», а вимикач повертає все', () => {
    setVisionMode(true);
    expect(getVision()).toEqual({ ...VISION_PRESET, motion: true });
    expect(root.dataset.motion).toBe('reduced');
    expect(root.dataset.textScale).toBe('150');

    setVisionMode(false);
    expect(getVision()).toEqual({ ...VISION_DEFAULTS, motion: false });
    expect(root.dataset.motion).toBeUndefined();
    expect(root.dataset.contrast).toBeUndefined();
    expect(localStorage.getItem(VISION_KEY)).toBeNull();
  });

  it('вимикаючи режим, не чіпає «Менше анімації», увімкнене раніше окремо', () => {
    updateVision({ motion: true });
    setVisionMode(true);
    setVisionMode(false);
    expect(getVision().motion).toBe(true);
  });

  it('окрема опція зберігається й сповіщає підписників', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVision(listener);
    updateVision({ scale: 175 });
    expect(stored()).toMatchObject({ scale: 175 });
    expect(root.dataset.textScale).toBe('175');
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('явне «звичайна» зберігається, щоб prefers-contrast не повернув високу', () => {
    mockContrastQuery(true);
    resetVisionCache();
    expect(getVision().contrast).toBe('high');
    updateVision({ contrast: 'normal' });
    resetVisionCache();
    expect(getVision().contrast).toBe('normal');
    expect(root.dataset.contrast).toBeUndefined();
  });

  it('Alt + Shift + V розпізнається за фізичною клавішею на будь-якій розкладці', () => {
    expect(isVisionShortcut({ altKey: true, shiftKey: true, code: 'KeyV', key: 'М' })).toBe(true);
    expect(isVisionShortcut({ altKey: true, shiftKey: false, code: 'KeyV' })).toBe(false);
    expect(isVisionShortcut({ altKey: true, shiftKey: true, ctrlKey: true, code: 'KeyV' })).toBe(false);
  });
});
