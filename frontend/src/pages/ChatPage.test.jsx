// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import ChatPage from './ChatPage';
import {
  answerClarify,
  fetchDiscussion,
  fetchModels,
  fetchPersonas,
  finishDiscussion,
  runDiscussion,
  updateDiscussion,
} from '../api/discussions';

vi.mock('../api/discussions', () => ({
  answerClarify: vi.fn(),
  fetchDiscussion: vi.fn(),
  fetchModels: vi.fn(),
  fetchPersonas: vi.fn(),
  finishDiscussion: vi.fn(),
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

  it('поки AI думають, показує зроблені кроки й те, над чим саме вони думають зараз', async () => {
    const running = {
      ...structuredClone(DISCUSSION),
      status: 'in_progress',
      phase: 'debate',
      is_finished: false,
      is_running: true,
      messages: DISCUSSION.messages.slice(0, 3).map((message) => ({
        ...message,
        thesis: message.role === 'ai' ? `${message.content} Теза.` : '',
      })),
      thinking: [
        { slug: 'emotional', name: 'Марта', text: '→ Учасник 1 · сперечається з тезою «Так, варто. Теза.»' },
      ],
    };
    vi.mocked(fetchDiscussion).mockResolvedValue(running);
    renderPage();

    const line = await screen.findByText('Марта → Учасник 1 · сперечається з тезою «Так, варто. Теза.»');
    expect(line).toBeInTheDocument();
    expect(screen.getByText('Учасник 1 · «Так, варто. Теза.»')).toBeInTheDocument();
    expect(screen.getByText('Марта · «Залежить від людей. Теза.»')).toBeInTheDocument();
  });

  it('замість «Аналізуємо…» показує, що саме зараз роблять AI', async () => {
    const running = {
      ...structuredClone(DISCUSSION),
      status: 'in_progress',
      phase: 'debate',
      is_finished: false,
      is_running: true,
      messages: DISCUSSION.messages.slice(0, 1),
      thinking: [{ slug: 'emotional', name: 'Марта', text: 'розвиває власну позицію' }],
      live: { status: '', search: '' },
    };
    vi.mocked(fetchDiscussion).mockResolvedValue(running);
    const { unmount } = renderPage();
    // модель ще не описала крок — видно етап
    expect(await screen.findByText('Обмінюємося аргументами…')).toBeInTheDocument();
    unmount();

    vi.mocked(fetchDiscussion).mockResolvedValue({
      ...running,
      live: { status: 'Порівнюємо зарплати й ризики…', search: '' },
    });
    const second = renderPage();
    expect(await screen.findByText('Порівнюємо зарплати й ризики…')).toBeInTheDocument();
    second.unmount();

    vi.mocked(fetchDiscussion).mockResolvedValue({
      ...running,
      live: { status: 'Порівнюємо зарплати й ризики…', search: 'медіанна зарплата в стартапах 2026' },
    });
    renderPage();
    expect(
      await screen.findByText('Шукаємо в інтернеті «медіанна зарплата в стартапах 2026»…')
    ).toBeInTheDocument();
  });

  it('після аналізу лишає згорнутий рядок «Аналізовано за …» з кроками', async () => {
    const user = userEvent.setup();
    const at = (seconds) => new Date(Date.UTC(2026, 9, 23, 9, 0, seconds)).toISOString();
    const finished = structuredClone(DISCUSSION);
    finished.messages = finished.messages.map((message, index) => ({
      ...message,
      created_at: at([0, 20, 40, 95][index]),
    }));
    vi.mocked(fetchDiscussion).mockResolvedValue(finished);
    renderPage();

    const status = await screen.findByText('Аналізовано за 1 хвилину 35 секунд');
    const toggle = status.closest('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const steps = [...toggle.closest('.thought-line').querySelectorAll('.thought-line__step-text')];
    expect(steps.map((step) => step.textContent)).toEqual(['Учасник 1', 'Марта', 'Модератор']);
  });

  it('фінальну репліку модератора не дублює — висновок лише в картці підсумку', async () => {
    const finished = structuredClone(DISCUSSION);
    finished.final_summary = { decision: 'Переходити, але домовитися про випробувальний строк.' };
    finished.messages.push({
      id: 'f', seq: 5, role: 'moderator', phase: 'final', persona_slug: 'moderator',
      persona_name: 'Модератор', avatar: '⚖️', content: 'Висновок модератора дослівно.',
    });
    vi.mocked(fetchDiscussion).mockResolvedValue(finished);
    renderPage();

    expect(await screen.findByText('Переходити, але домовитися про випробувальний строк.')).toBeInTheDocument();
    expect(screen.queryByText('Висновок модератора дослівно.')).not.toBeInTheDocument();
    // проміжне узагальнення модератора лишається в чаті
    expect(screen.getByText('Підсумок.')).toBeInTheDocument();
  });

  it('нова модель учасника зберігається на сервері', async () => {
    const user = userEvent.setup();
    vi.mocked(updateDiscussion).mockResolvedValue(structuredClone(DISCUSSION));
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' });
    const sheet = sheetOf('Учасник 1');

    await user.click(within(sheet).getByRole('button', { name: 'Модель AI' }));
    await user.click(screen.getByRole('option', { name: 'Provider — Model Two' }));

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

    await user.click(screen.getByRole('button', { name: 'Назад' }));
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

  it('модератор питає в чаті: варіант і своя відповідь ідуть на сервер, раннер не підштовхується', async () => {
    const user = userEvent.setup();
    const questions = [
      { id: 'q1', question: 'Який у вас досвід?', options: ['До року', 'Понад три роки'] },
      { id: 'q2', question: 'Що найважливіше?', options: ['Гроші', 'Розвиток'] },
      { id: 'q3', question: 'Є запасний план?', options: ['Так', 'Ні'] },
    ];
    vi.mocked(fetchDiscussion).mockResolvedValue({
      ...structuredClone(DISCUSSION),
      status: 'in_progress',
      phase: 'clarify',
      is_finished: false,
      clarify_questions: questions,
      messages: [structuredClone(DISCUSSION.messages[0])],
    });
    vi.mocked(answerClarify).mockResolvedValue({
      ...structuredClone(DISCUSSION),
      status: 'in_progress',
      phase: 'opening',
      is_finished: false,
      is_running: true,
      clarify_questions: [],
      clarifications: [{ question: 'Який у вас досвід?', answer: 'Понад три роки' }],
      messages: [],
    });
    renderPage();

    const card = await screen.findByRole('form', { name: /Уточніть кілька деталей/ });
    expect(runDiscussion).not.toHaveBeenCalled();
    // по одному питанню за раз; вибір варіанта гортає далі
    expect(within(card).getByText('1 з 3')).toBeInTheDocument();
    expect(within(card).queryByText('Що найважливіше?')).not.toBeInTheDocument();
    await user.click(within(card).getByRole('radio', { name: /Понад три роки/ }));
    expect(await within(card).findByText('Що найважливіше?')).toBeInTheDocument();
    // цифра з клавіатури обирає варіант
    await user.keyboard('1');
    expect(await within(card).findByText('Є запасний план?')).toBeInTheDocument();
    // повертаємось і пишемо свою відповідь — вона замінює обраний варіант
    await user.click(within(card).getByRole('button', { name: 'Попереднє питання' }));
    await user.type(within(card).getByRole('textbox', { name: 'Своя відповідь: Що найважливіше?' }), 'Команда');
    expect(within(card).getByRole('radio', { name: /Гроші/ })).toHaveAttribute('aria-checked', 'false');
    await user.click(within(card).getByRole('button', { name: 'Далі' }));
    await user.click(within(card).getByRole('button', { name: 'Почати дискусію' }));

    expect(answerClarify).toHaveBeenCalledWith('d1', [
      { question: 'Який у вас досвід?', answer: 'Понад три роки' },
      { question: 'Що найважливіше?', answer: 'Команда' },
      { question: 'Є запасний план?', answer: '' },
    ]);
    expect(screen.queryByRole('form', { name: /Уточніть кілька деталей/ })).not.toBeInTheDocument();
    expect(screen.getByText('Понад три роки')).toBeInTheDocument();
  });

  it('«Пропустити» надсилає порожні відповіді', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchDiscussion).mockResolvedValue({
      ...structuredClone(DISCUSSION),
      status: 'in_progress',
      phase: 'clarify',
      is_finished: false,
      clarify_questions: [{ id: 'q1', question: 'Який у вас досвід?', options: ['До року', 'Понад три роки'] }],
      messages: [structuredClone(DISCUSSION.messages[0])],
    });
    vi.mocked(answerClarify).mockResolvedValue({
      ...structuredClone(DISCUSSION),
      phase: 'opening',
      is_finished: false,
      clarify_questions: [],
      messages: [],
    });
    renderPage();

    const card = await screen.findByRole('form', { name: /Уточніть кілька деталей/ });
    await user.click(within(card).getByRole('radio', { name: /До року/ }));
    await user.click(within(card).getByRole('button', { name: 'Пропустити все' }));
    expect(answerClarify).toHaveBeenCalledWith('d1', []);
  });

  it('зупинену дискусію можна продовжити або одразу завершити', async () => {
    const user = userEvent.setup();
    const stopped = {
      ...structuredClone(DISCUSSION),
      status: 'in_progress',
      phase: 'debate',
      is_finished: false,
      stop_requested: true,
      messages: structuredClone(DISCUSSION.messages.slice(0, 3)),
    };
    vi.mocked(fetchDiscussion).mockResolvedValue(stopped);
    vi.mocked(finishDiscussion).mockResolvedValue({ ...stopped, phase: 'synthesis', stop_requested: false });
    renderPage();

    const card = (await screen.findByText('Дискусію зупинено')).closest('.notice');
    expect(within(card).getByRole('button', { name: 'Продовжити' })).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Завершити' }));
    expect(finishDiscussion).toHaveBeenCalledWith('d1');
  });

  it('поки учасники мовчать, зупинену дискусію можна лише продовжити', async () => {
    vi.mocked(fetchDiscussion).mockResolvedValue({
      ...structuredClone(DISCUSSION),
      status: 'in_progress',
      phase: 'opening',
      is_finished: false,
      stop_requested: true,
      messages: [structuredClone(DISCUSSION.messages[0])],
    });
    renderPage();

    expect(await screen.findByText('Дискусію зупинено')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продовжити' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Завершити' })).not.toBeInTheDocument();
  });
});
