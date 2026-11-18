import { describe, expect, it } from 'vitest';
import { draftMessagesOf, isIdle, visibleDraftsOf, lastSeqOf, mergeMessages } from './chatMessages';
import { stanceLabel, stanceTone } from './chatView';

describe('mergeMessages', () => {
  it('додає лише нові репліки й тримає їх за порядком', () => {
    const current = [{ id: 'a', seq: 1 }, { id: 'b', seq: 2 }];
    const merged = mergeMessages(current, [{ id: 'b', seq: 2 }, { id: 'c', seq: 3 }]);
    expect(merged.map((message) => message.id)).toEqual(['a', 'b', 'c']);
  });

  it('без нових реплік повертає той самий масив — React не перемальовує чат', () => {
    const current = [{ id: 'a', seq: 1 }];
    expect(mergeMessages(current, [{ id: 'a', seq: 1 }])).toBe(current);
  });
});

describe('draftMessagesOf', () => {
  it('перетворює чернетки з сервера на репліки для спільного рендеру', () => {
    const [draft] = draftMessagesOf({
      live: {
        drafts: [{ slug: 'skeptic', name: 'Скептик', phase: 'debate', round: 2, text: 'Пишу…' }],
      },
    });
    expect(draft).toMatchObject({
      id: 'draft-skeptic',
      draft: true,
      role: 'ai',
      persona_slug: 'skeptic',
      persona_name: 'Скептик',
      round: 2,
      content: 'Пишу…',
    });
  });

  it('без живого стану чернеток немає', () => {
    expect(draftMessagesOf({})).toEqual([]);
  });
});

describe('isIdle', () => {
  const base = { is_running: false, is_finished: false, stop_requested: false, status: 'in_progress' };

  it('незавершена дискусія без раннера — його треба запустити', () => {
    expect(isIdle(base)).toBe(true);
  });

  it('чекає на людину, зупинена чи впала — не запускаємо', () => {
    expect(isIdle({ ...base, phase: 'clarify', clarify_questions: [{ id: 'q' }] })).toBe(false);
    expect(isIdle({ ...base, stop_requested: true })).toBe(false);
    expect(isIdle({ ...base, status: 'failed' })).toBe(false);
  });
});

describe('lastSeqOf', () => {
  it('найбільший номер репліки або 0', () => {
    expect(lastSeqOf({ messages: [{ seq: 3 }, { seq: 7 }] })).toBe(7);
    expect(lastSeqOf(null)).toBe(0);
  });
});

describe('мітка позиції учасника', () => {
  it('у «так/ні» — людськими словами, з кольором відповіді', () => {
    expect(stanceLabel({ stance: 'ні' }, 'yes_no')).toBe('Каже «ні»');
    expect(stanceLabel({ stance: 'так' }, 'yes_no')).toBe('Каже «так»');
    expect(stanceTone('так')).toBe('agree');
    expect(stanceTone('ні')).toBe('disagree');
  });
  it('в «одному з варіантів» — обраний варіант', () => {
    expect(stanceLabel({ stance: 'Київ' }, 'choose_one')).toBe('Обирає «Київ»');
  });
});

describe('visibleDraftsOf', () => {
  const draft = (slug, extra = {}) => ({ slug, text: 'текст', elapsed: 5, ...extra });

  it('shows a lone writer live', () => {
    expect(visibleDraftsOf({ drafts: [draft('skeptic')] })).toHaveLength(1);
  });

  it('hides bubbles while several participants write at once', () => {
    expect(visibleDraftsOf({ drafts: [draft('skeptic'), draft('logician')], slow_after: 40 })).toEqual([]);
  });

  it('still shows a stuck participant so its model can be swapped', () => {
    const stuck = draft('logician', { elapsed: 50 });
    expect(visibleDraftsOf({ drafts: [draft('skeptic'), stuck], slow_after: 40 })).toEqual([stuck]);
  });
});
