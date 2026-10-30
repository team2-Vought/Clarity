// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRunAlerts } from './useRunAlerts';
import { alertUser, isAway } from '../utils/notify';

vi.mock('../utils/notify', () => ({ alertUser: vi.fn(), isAway: vi.fn() }));

const working = { id: 'd1', title: 'Переїзд', phase: 'debate', status: 'in_progress', is_running: true };
const done = {
  ...working,
  phase: 'done',
  status: 'done',
  is_running: false,
  is_finished: true,
  final_summary: { decision: '**Так**, переїжджати варто.' },
};

beforeEach(() => {
  vi.mocked(alertUser).mockReset();
  vi.mocked(isAway).mockReturnValue(true);
});

afterEach(() => {
  vi.mocked(isAway).mockReset();
});

describe('useRunAlerts', () => {
  it('кличе людину, яка пішла з вкладки, коли висновок готовий', () => {
    const { result, rerender } = renderHook(({ discussion }) => useRunAlerts(discussion), {
      initialProps: { discussion: working },
    });
    expect(result.current).toBe('');

    rerender({ discussion: done });
    expect(alertUser).toHaveBeenCalledWith({
      title: 'Висновок готовий',
      body: 'Так, переїжджати варто.',
      tag: 'clarity-d1',
    });
    expect(result.current).toBe('✓');

    // людина повернулась — позначка зникає
    vi.mocked(isAway).mockReturnValue(false);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current).toBe('');
  });

  it('модератор чекає на відповіді — теж привід покликати', () => {
    const { result, rerender } = renderHook(({ discussion }) => useRunAlerts(discussion), {
      initialProps: { discussion: working },
    });
    rerender({
      discussion: { ...working, is_running: false, phase: 'clarify', clarify_questions: [{ id: 'q1' }] },
    });
    expect(alertUser).toHaveBeenCalledWith(expect.objectContaining({ title: 'Модератор чекає на вас' }));
    expect(result.current).toBe('•');
  });

  it('не турбує, якщо людина дивиться на чат або дискусію відкрили вже готовою', () => {
    vi.mocked(isAway).mockReturnValue(false);
    const { rerender } = renderHook(({ discussion }) => useRunAlerts(discussion), {
      initialProps: { discussion: working },
    });
    rerender({ discussion: done });

    vi.mocked(isAway).mockReturnValue(true);
    renderHook(() => useRunAlerts(done));
    expect(alertUser).not.toHaveBeenCalled();
  });
});
