import { describe, expect, it } from 'vitest';
import { plainText, toneFor } from './voice';

describe('voice', () => {
  it('reads markdown as plain speech', () => {
    expect(plainText('**Так.** Варто [1] переїхати — див. [джерело](https://x.y).\n- перший крок')).toBe(
      'Так. Варто переїхати — див. джерело. перший крок'
    );
  });

  it('gives every character its own steady tone', () => {
    expect(toneFor('devil').pitch).toBeLessThan(toneFor('creative').pitch);
    expect(toneFor('custom-role')).toEqual(toneFor('custom-role'));
  });
});
