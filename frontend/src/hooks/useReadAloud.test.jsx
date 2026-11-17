// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReadAloud } from './useReadAloud';

const msg = (id, content = `Репліка ${id}`) => ({ id, role: 'ai', persona_slug: 'skeptic', content });

describe('useReadAloud', () => {
  let spoken;
  beforeEach(() => {
    spoken = [];
    localStorage.setItem('clarity:read-aloud', 'on');
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    window.speechSynthesis = {
      speak: (u) => {
        spoken.push(u.text);
        setTimeout(() => u.onend?.(), 0);
      },
      cancel: vi.fn(),
      getVoices: () => [],
    };
  });
  afterEach(() => {
    localStorage.clear();
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
  });

  it('does not read the history aloud, only replies that arrive later', async () => {
    const { rerender } = renderHook(({ messages }) => useReadAloud(messages), {
      initialProps: { messages: null },
    });
    rerender({ messages: [msg(1), msg(2)] });
    rerender({ messages: [msg(1), msg(2), msg(3)] });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(spoken).toEqual(['Репліка 3']);
  });
});
