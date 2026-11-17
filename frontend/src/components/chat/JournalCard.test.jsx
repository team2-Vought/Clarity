// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../Toast';
import JournalForm, { JournalButton } from './JournalCard';
import { useJournal } from '../../hooks/useJournal';
import { recordDecision } from '../../api/journal';

vi.mock('../../api/journal', () => ({
  recordDecision: vi.fn(),
  fetchJournalDue: vi.fn(() => Promise.resolve({ count: 0, next: null })),
}));

const DISCUSSION = {
  id: 'd1',
  final_summary: { answer: 'так', decision: '**Варто** переїжджати, якщо оренда до 15 000.' },
  journal: null,
};

// як у картці підсумку: кнопка в рядку дій, форма — під ним
function JournalCard({ discussion }) {
  const journal = useJournal(discussion);
  return (
    <>
      <JournalButton journal={journal} />
      <JournalForm discussion={discussion} journal={journal} />
    </>
  );
}

const renderCard = (discussion = DISCUSSION) =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <JournalCard discussion={discussion} />
      </MemoryRouter>
    </ToastProvider>
  );

beforeEach(() => {
  vi.mocked(recordDecision).mockReset();
});

describe('JournalCard', () => {
  it('записує рішення з підставленим висновком і обраним нагадуванням', async () => {
    const user = userEvent.setup();
    vi.mocked(recordDecision).mockResolvedValue({ id: 'e1', check_at: '2026-11-06T10:00:00Z', status: 'waiting' });
    renderCard();
    await user.click(screen.getByRole('button', { name: /Додати рішення в журнал/ }));

    const field = screen.getByRole('textbox', { name: 'Що ви вирішили' });
    expect(field).toHaveValue('Так. Варто переїжджати, якщо оренда до 15 000.');
    await user.click(screen.getByRole('radio', { name: 'тиждень' }));
    await user.click(screen.getByRole('button', { name: 'Додати в журнал' }));

    expect(recordDecision).toHaveBeenCalledWith({
      discussion: 'd1',
      decision: 'Так. Варто переїжджати, якщо оренда до 15 000.',
      remindInDays: 7,
      // висновок лишили як є — це рішення за порадою Clarity
      followedAdvice: true,
    });
    expect(await screen.findByRole('button', { name: /У журналі · спитаємо/ })).toBeInTheDocument();
  });

  it('уже записане рішення показує, коли спитаємо', () => {
    renderCard({ ...DISCUSSION, journal: { id: 'e1', check_at: '2026-11-29T10:00:00Z', status: 'waiting' } });
    expect(screen.getByRole('button', { name: /У журналі · спитаємо 29 листопада/ })).toBeInTheDocument();
  });
});
