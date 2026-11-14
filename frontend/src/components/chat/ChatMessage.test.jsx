// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatMessage from './ChatMessage';
import { draftMessagesOf } from '../../utils/chatMessages';
import { copy } from '../../copy';

const t = copy.chat;

const draftOf = (draft) =>
  draftMessagesOf({ live: { drafts: [{ slug: 'emotional', name: 'Емпат', text: '', ...draft }] } })[0];

const renderDraft = (message, props = {}) =>
  render(
    <ChatMessage
      message={message}
      speakers={new Map()}
      models={[]}
      discussion={{}}
      customNames={new Map()}
      sourcesById={new Map()}
      onCopy={() => {}}
      onJump={() => {}}
      onExpand={() => {}}
      slowAfter={35}
      {...props}
    />
  );

describe('чернетка учасника', () => {
  it('у звичайному ході під чернеткою нічого немає', () => {
    renderDraft(draftOf({ elapsed: 12 }), { onSwapModel: () => {} });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: t.draftSwap })).toBeNull();
  });

  it('пояснює, що модель замінили', () => {
    renderDraft(draftOf({ elapsed: 3, swapped: true }), { onSwapModel: () => {} });
    expect(screen.getByText(t.draftSwapped)).toBeTruthy();
  });

  it('після порогу чесно каже про затримку й дає замінити модель', async () => {
    const onSwapModel = vi.fn();
    renderDraft(draftOf({ elapsed: 40 }), { onSwapModel });
    expect(screen.getByText(t.draftSlow('Емпат'))).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: t.draftSwap }));
    expect(onSwapModel).toHaveBeenCalledWith('emotional');
  });

  it('готовий учасник не має ні підпису, ні кнопки заміни', () => {
    renderDraft(draftOf({ elapsed: 50, done: true, text: 'Готова відповідь.' }), { onSwapModel: () => {} });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: t.draftSwap })).toBeNull();
  });
});
