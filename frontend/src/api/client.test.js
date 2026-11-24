// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, KEEP_WARM_INTERVAL_MS, _resetWakeState, keepServerWarm } from './client';
import { copy } from '../copy';
import { describeError } from '../utils/errorKind';

describe('ApiError', () => {
  it('без пояснення від сервера дає зрозумілий текст за кодом, а не «Request failed»', () => {
    const err = new ApiError(502, null);
    expect(err.message).toBe(copy.errors.http[502]);
    expect(err.message).not.toMatch(/Request failed/);
    expect(new ApiError(418, null).message).toBe(copy.errors.httpOther(418));
  });

  it('пояснення сервера має перевагу', () => {
    expect(new ApiError(400, { detail: 'Порожнє питання' }).message).toBe('Порожнє питання');
  });

  it('describeError визначає вид помилки для блоку', () => {
    expect(describeError(new ApiError(503, null), 'x').kind).toBe('server');
    expect(describeError(new ApiError(0, null), 'x')).toEqual({ kind: 'network', text: copy.errors.network });
    expect(describeError(new ApiError(429, null), 'x').kind).toBe('limit');
  });
});

describe('keepServerWarm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
    _resetWakeState();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('пінгує /api/health/ одразу та кожні 10 хвилин у видимій вкладці', async () => {
    const stop = keepServerWarm();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/health/', { credentials: 'omit', cache: 'no-store' });

    await vi.advanceTimersByTimeAsync(KEEP_WARM_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(KEEP_WARM_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(3);
    stop();
  });

  it('не пінгує у фоновій вкладці, але будить одразу при поверненні після 10 хв', async () => {
    let state = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);

    const stop = keepServerWarm();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);

    state = 'hidden';
    await vi.advanceTimersByTimeAsync(KEEP_WARM_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(1);

    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
  });
});
