import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
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
