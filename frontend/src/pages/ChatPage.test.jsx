// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import ChatPage from './ChatPage';
import { fetchDiscussion, fetchModels, fetchPersonas, updateDiscussion } from '../api/discussions';

vi.mock('../api/discussions', () => ({
  fetchDiscussion: vi.fn(),
  fetchModels: vi.fn(),
  fetchPersonas: vi.fn(),
  postNote: vi.fn(),
  runDiscussion: vi.fn(),
  shareDiscussion: vi.fn(),
  stopDiscussion: vi.fn(),
  unshareDiscussion: vi.fn(),
  updateDiscussion: vi.fn(),
}));

const DISCUSSION = {
  id: 'd1',
  title: 'Нова робота',
  question: 'Чи варто переходити на нову роботу?',
  mode: 'yes_no',
  options: [],
  status: 'done',
  phase: 'done',
  is_finished: true,
  is_running: false,
  stop_requested: false,
  rounds: 2,
  current_round: 1,
  web_search: false,
  sources: [],
  moderator_model: '',
  devil_model: '',
  share_token: null,
  followups: 0,
  max_followups: 3,
  personas: [
    { slug: 'logician', name: 'Учасник 1', model: 'm1', traits: ['Реаліст'] },
    { slug: 'emotional', name: 'Марта', model: 'm1', traits: [] },
  ],
  messages: [
    { id: 'q', seq: 1, role: 'user', phase: 'opening', persona_slug: 'user', persona_name: 'Ви', avatar: '🧑', content: 'Чи варто переходити на нову роботу?' },
    { id: 'a1', seq: 2, role: 'ai', phase: 'opening', round: 1, persona_slug: 'logician', persona_name: 'Учасник 1', avatar: '🧠', content: 'Так, варто.', stance: 'Так' },
    { id: 'a2', seq: 3, role: 'ai', phase: 'opening', round: 1, persona_slug: 'emotional', persona_name: 'Марта', avatar: '❤️‍🔥', content: 'Залежить від людей.', stance: 'Ні' },
    { id: 'm', seq: 4, role: 'moderator', phase: 'synthesis', persona_slug: 'moderator', persona_name: 'Модератор', avatar: '⚖️', content: 'Підсумок.' },
  ],
};

const MODELS = [
  { id: 'm1', provider: 'Provider', label: 'Model One', available: true },
  { id: 'm2', provider: 'Provider', label: 'Model Two', available: true },
];

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/chat/d1']}>
        <Routes>
          <Route path="/chat/:id" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );

const sheetOf = (name) => screen.getByRole('region', { name: `Налаштування учасника «${name}»` });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetchDiscussion).mockResolvedValue(structuredClone(DISCUSSION));
  vi.mocked(fetchPersonas).mockResolvedValue({
    personas: [
      { slug: 'logician', name: 'Логік' },
      { slug: 'emotional', name: 'Емоційний' },
    ],
  });
  vi.mocked(fetchModels).mockResolvedValue({ models: MODELS, default_model: 'm1' });
  vi.mocked(updateDiscussion).mockReset();
});

describe('ChatPage', () => {
  it('показує склад жетонами й анкету вибраного учасника з його рисами', async () => {
    const user = userEvent.setup();
    renderPage();
    const first = await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    const sheet = sheetOf('Учасник 1');
    expect(within(sheet).getByText('Логік')).toBeInTheDocument();
    expect(within(sheet).getByText('Реаліст')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Вибрати учасника «Марта»' }));
    const second = sheetOf('Марта');
    expect(within(second).getByText('Емоційний')).toBeInTheDocument();
    expect(within(second).getByText('Без особливих рис')).toBeInTheDocument();
  });

  it('нова модель учасника зберігається на сервері', async () => {
    const user = userEvent.setup();
    vi.mocked(updateDiscussion).mockResolvedValue(structuredClone(DISCUSSION));
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' });
    const sheet = sheetOf('Учасник 1');

    await user.click(within(sheet).getByRole('button', { name: 'Модель AI' }));
    await user.click(within(sheet).getByRole('option', { name: 'Provider — Model Two' }));

    expect(updateDiscussion).toHaveBeenCalledWith('d1', {
      personas: [{ slug: 'logician', model: 'm2' }],
    });
  });

  it('«Додатково» відкриває окремий екран із суддями й повертається назад', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' });

    await user.click(screen.getByRole('button', { name: /^Додатково/ }));
    expect(screen.getByRole('heading', { name: 'Судді' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Модель модератора' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Модель AI Devil' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Назад до учасників' }));
    expect(screen.getByRole('button', { name: 'Вибрати учасника «Учасник 1»' })).toBeInTheDocument();
  });

  it('аватари реплік — іконки ролей, а не емодзі з сервера', async () => {
    renderPage();
    await screen.findByText('Підсумок.');
    const avatars = document.querySelectorAll('.chat__avatar');
    expect(avatars.length).toBeGreaterThan(0);
    avatars.forEach((avatar) => {
      expect(avatar.textContent).not.toMatch(/🧠|⚖️|❤️/u);
      expect(avatar.querySelector('svg')).not.toBeNull();
    });
  });
});
