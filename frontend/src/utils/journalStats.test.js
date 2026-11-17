import { describe, expect, it } from 'vitest';
import { journalStats } from './journalStats';

const entry = (outcome, followed, reviewed = true) => ({
  outcome,
  followed_advice: followed,
  reviewed_at: reviewed ? '2026-11-01T10:00:00Z' : null,
});

describe('journalStats', () => {
  it('counts the success rate only among decisions that followed the advice', () => {
    const stats = journalStats([
      entry('good', true),
      entry('bad', true),
      entry('mixed', true),
      entry('good', true),
      entry('bad', false),
      entry('good', null),
      entry('', true, false),
    ]);
    expect(stats).toMatchObject({ total: 6, good: 3, mixed: 1, bad: 2, followed: 4, followedGood: 2, rate: 50 });
  });

  it('has no rate before any review', () => {
    expect(journalStats([entry('', true, false)]).rate).toBeNull();
    expect(journalStats(null).total).toBe(0);
  });
});
