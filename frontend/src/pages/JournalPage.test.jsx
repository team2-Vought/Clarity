// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import JournalPage from './JournalPage';
import { fetchJournal, updateDecision } from '../api/journal';
import { fetchSettings, updatePreferences } from '../api/settings';

vi.mock('../api/journal', () => ({
  fetchJournal: vi.fn(),
  fetchJournalDue: vi.fn(() => Promise.resolve({ count: 0, next: null })),
  updateDecision: vi.fn(),
  deleteDecision: vi.fn(),
}));
vi.mock('../api/settings', () => ({
  fetchSettings: vi.fn(),
  updatePreferences: vi.fn(() => Promise.resolve({})),
}));

const DUE = {
  id: 'e1',
  discussion_id: 'd1',
  question: 'Чи переїжджати до Києва?',
  decision: 'Переїжджаю в березні',
  steps: ['Порахувати бюджет', 'Подзвонити рієлтору'],
  done_steps: [],
  triggers: ['Якщо оренда дорожча за 20 000 — переглянути'],
  check_at: '2026-10-01T10:00:00Z',
  created_at: '2026-09-01T10:00:00Z',
  outcome: '',
  reflection: '',
  reviewed_at: null,
  status: 'due',
};
const DONE = {
  ...DUE,
  id: 'e2',
  decision: 'Взяв ноутбук',
  steps: [],
  triggers: [],
  outcome: 'good',
  reflection: 'Добре, що не чекав',
  reviewed_at: '2026-10-02T10:00:00Z',
  status: 'reviewed',
};

const renderPage = (path = '/journal') =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/journal" element={<JournalPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );

beforeEach(() => {
  vi.mocked(fetchJournal).mockResolvedValue({ results: [DUE, DONE], due_count: 1 });
  vi.mocked(fetchSettings).mockResolvedValue({ preferences: { journal_emails: true } });
  vi.mocked(updateDecision).mockReset();
});

describe('JournalPage', () => {
  it('ділить рішення на «час підбити підсумок» і підсумовані', async () => {
    renderPage();
    const due = await screen.findByRole('region', { name: /Час підбити підсумок/ });
    expect(within(due).getByText('Переїжджаю в березні')).toBeInTheDocument();
    const reviewed = screen.getByRole('region', { name: /Підсумовані/ });
    expect(within(reviewed).getByText('Добре')).toBeInTheDocument();
    expect(within(reviewed).getByText('Добре, що не чекав')).toBeInTheDocument();
  });

  it('картки згорнуті, а «Як воно?» відкриває форму з обраною відповіддю', async () => {
    const user = userEvent.setup();
    vi.mocked(updateDecision).mockResolvedValue({ ...DUE, outcome: 'mixed', status: 'reviewed' });
    renderPage();
    const due = await screen.findByRole('region', { name: /Час підбити підсумок/ });
    expect(within(due).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(due).getByText('0 з 2')).toBeInTheDocument();

    await user.click(within(due).getByRole('button', { name: 'По-різному' }));
    expect(within(due).getByRole('radio', { name: 'По-різному' })).toHaveAttribute('aria-checked', 'true');
    await user.type(within(due).getByRole('textbox'), 'Дорожче, ніж думав');
    await user.click(within(due).getByRole('button', { name: 'Зберегти підсумок' }));
    expect(updateDecision).toHaveBeenCalledWith('e1', { outcome: 'mixed', reflection: 'Дорожче, ніж думав' });
  });

  it('позначає кроки плану зробленими', async () => {
    const user = userEvent.setup();
    vi.mocked(updateDecision).mockResolvedValue({ ...DUE, done_steps: [1] });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Переїжджаю в березні/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Подзвонити рієлтору' }));
    expect(updateDecision).toHaveBeenCalledWith('e1', { done_steps: [1] });
    expect(screen.getByText('1 з 2')).toBeInTheDocument();
  });

  it('«Ще рано» відкладає питання на тиждень', async () => {
    const user = userEvent.setup();
    vi.mocked(updateDecision).mockResolvedValue({ ...DUE, status: 'waiting' });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Переїжджаю в березні/ }));
    await user.click(screen.getByRole('button', { name: 'Ще рано — спитати через тиждень' }));
    expect(updateDecision).toHaveBeenCalledWith('e1', { remind_in_days: 7 });
  });

  it('листи-нагадування вимикаються перемикачем', async () => {
    const user = userEvent.setup();
    renderPage();
    const emails = await screen.findByRole('switch', { name: /Нагадувати листом/ });
    expect(emails).toBeChecked();
    await user.click(emails);
    expect(updatePreferences).toHaveBeenCalledWith({ journal_emails: false });
  });

  it('порожній журнал пояснює, як туди потрапляють рішення', async () => {
    vi.mocked(fetchJournal).mockResolvedValue({ results: [], due_count: 0 });
    renderPage();
    expect(await screen.findByText(/Журнал поки порожній/)).toBeInTheDocument();
  });
});
