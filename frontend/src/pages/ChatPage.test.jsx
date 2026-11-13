// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import ChatPage from './ChatPage';
import {
  postNote,
  sendFeedback,
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
  sendFeedback: vi.fn(),
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
  it('видалена чи чужа дискусія — «не знайдено» з переходом в історію, без панелі', async () => {
    vi.mocked(fetchDiscussion).mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Дискусію не знайдено' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Відкрити історію' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Спробувати ще раз' })).not.toBeInTheDocument();
  });

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

  it('показує репліку, поки модель її пише, і не «друкує» її вдруге', async () => {
    const running = {
      ...structuredClone(DISCUSSION),
      status: 'in_progress',
      phase: 'opening',
      is_finished: false,
      is_running: true,
      messages: DISCUSSION.messages.slice(0, 2),
      thinking: [],
      live: {
        status: '',
        search: '',
        drafts: [{ slug: 'emotional', name: 'Марта', phase: 'opening', round: 1, text: 'Залежить від' }],
      },
    };
    vi.mocked(fetchDiscussion)
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce({
        ...running,
        phase: 'debate',
        messages: [DISCUSSION.messages[2]],
        live: { status: '', search: '', drafts: [] },
      })
      .mockResolvedValue({ ...running, phase: 'debate', messages: [], live: { status: '', search: '', drafts: [] } });
    renderPage();

    expect(await screen.findByText('Залежить від')).toBeInTheDocument();
    expect(document.querySelector('.chat__bubble--draft')).not.toBeNull();

    // крок завершився: збережена репліка заміняє чернетку одразу, без анімації друку
    await waitFor(
      () => expect(screen.getByText('Залежить від людей.')).toBeInTheDocument(),
      { timeout: 3000 }
    );
    expect(document.querySelector('.chat__bubble--draft')).toBeNull();
    expect(document.querySelector('.chat__bubble--typing')).toBeNull();
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
      { id: 'q1', question: 'Який у вас досвід?', why: 'Від досвіду залежить ризик.', options: ['До року', 'Понад три роки'] },
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
    // питання модератора й останнім — «Що ще команді варто знати?»; під питанням — навіщо питають
    expect(within(card).getByText('1 з 4')).toBeInTheDocument();
    expect(within(card).getByText('Від досвіду залежить ризик.')).toBeInTheDocument();
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
    await user.click(within(card).getByRole('button', { name: 'Далі' }));
    // останній крок — вільне поле для того, про що модератор не спитав
    await user.type(within(card).getByRole('textbox', { name: 'Що ще команді варто знати?' }), 'Дружина проти');
    await user.click(within(card).getByRole('button', { name: 'Почати дискусію' }));

    expect(answerClarify).toHaveBeenCalledWith('d1', [
      { question: 'Який у вас досвід?', answer: 'Понад три роки' },
      { question: 'Що найважливіше?', answer: 'Команда' },
      { question: 'Є запасний план?', answer: '' },
      { question: 'Що ще команді варто знати?', answer: 'Дружина проти' },
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

  it('зупинену дискусію можна продовжити або одразу обірвати без висновку', async () => {
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
    vi.mocked(finishDiscussion).mockResolvedValue({
      ...stopped,
      status: 'done',
      phase: 'done',
      is_finished: true,
      stop_requested: false,
      finished_early: true,
      final_summary: null,
    });
    renderPage();

    const card = (await screen.findByText('Дискусію зупинено')).closest('.notice');
    expect(within(card).getByRole('button', { name: 'Продовжити' })).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Завершити' }));
    expect(finishDiscussion).toHaveBeenCalledWith('d1');
    expect(
      await screen.findByText('Ви завершили дискусію достроково — без висновку модератора')
    ).toBeInTheDocument();
    expect(screen.queryByText('Дискусію зупинено')).not.toBeInTheDocument();
    expect(runDiscussion).not.toHaveBeenCalled();
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

  it('після висновку питання можна адресувати одному учаснику', async () => {
    const user = userEvent.setup();
    const done = {
      ...structuredClone(DISCUSSION),
      final_summary: { decision: 'Переходити варто.', answer: 'так' },
      max_direct: 10,
      direct_questions: 0,
    };
    vi.mocked(fetchDiscussion).mockResolvedValue(done);
    vi.mocked(postNote).mockResolvedValue({
      message: { id: 'u2', seq: 5, role: 'user', phase: 'answer', content: 'А зарплата?' },
      discussion: { ...done, phase: 'answer', is_finished: false, is_running: true },
    });
    renderPage();
    const chips = await screen.findByRole('radiogroup', { name: 'Кому' });
    expect(within(chips).getByRole('radio', { name: 'Усім' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(chips).getByRole('radio', { name: 'Марта' }));

    const field = screen.getByRole('textbox', { name: /Питання для «Марта»/ });
    await user.type(field, 'А зарплата?');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    expect(postNote).toHaveBeenCalledWith('d1', 'А зарплата?', 'emotional', { quick: false, attachments: [] });
  });

  it('меню біля поля: швидка відповідь на уточнення й пошук посеред дискусії', async () => {
    const user = userEvent.setup();
    const done = { ...structuredClone(DISCUSSION), final_summary: { decision: 'Переходити варто.', answer: 'так' } };
    vi.mocked(fetchDiscussion).mockResolvedValue(done);
    vi.mocked(fetchPersonas).mockResolvedValue({ personas: [], search: { available: true } });
    vi.mocked(updateDiscussion).mockResolvedValue({ ...done, web_search: true });
    vi.mocked(postNote).mockResolvedValue({
      message: { id: 'u2', seq: 5, role: 'user', phase: 'quick', content: 'А коротко?' },
      discussion: { ...done, phase: 'quick', is_finished: false, is_running: true },
    });
    const { container } = renderPage();

    await user.click(await screen.findByRole('button', { name: /Формат відповіді й параметри/ }));
    const quick = screen.getByRole('menuitemcheckbox', { name: /Швидка відповідь/ });
    expect(quick).toHaveAttribute('aria-checked', 'false');
    await user.click(quick);
    expect(quick).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Пошук в інтернеті/ }));
    expect(updateDiscussion).toHaveBeenCalledWith('d1', { webSearch: true });

    await user.type(container.querySelector('.chat__composer-box textarea'), 'А коротко?');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    expect(postNote).toHaveBeenCalledWith('d1', 'А коротко?', '', { quick: true, attachments: [] });
  });

  it('криза: замість висновку — контакти допомоги', async () => {
    vi.mocked(fetchDiscussion).mockResolvedValue({
      ...structuredClone(DISCUSSION),
      safety: 'crisis',
      messages: DISCUSSION.messages.slice(0, 1),
    });
    renderPage();
    const help = await screen.findByRole('region', { name: 'Вам не потрібно проходити через це наодинці' });
    expect(within(help).getByText('7333')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Кому' })).not.toBeInTheDocument();
  });

  it('висновок показує матрицю критеріїв, застереження й питає, чи допоміг', async () => {
    const user = userEvent.setup();
    vi.mocked(sendFeedback).mockResolvedValue({ feedback: 'not_helped', feedback_note: '' });
    vi.mocked(fetchDiscussion).mockResolvedValue({
      ...structuredClone(DISCUSSION),
      mode: 'choose_one',
      options: ['Київ', 'Львів'],
      safety: 'financial',
      final_summary: { decision: 'Обрати Київ.', answer: 'Київ' },
      matrix: {
        criteria: [{ name: 'Зарплата', weight: 5 }, { name: 'Сім’я', weight: 3 }],
        rows: [
          { option: 'Київ', scores: [9, 3], total: 6.8 },
          { option: 'Львів', scores: [5, 9], total: 6.5 },
        ],
        winner: 'Київ',
        participants: 2,
      },
    });
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: /Зарплата/ })).toHaveTextContent('вага 5');
    expect(within(table).getByRole('rowheader', { name: /Київ/ })).toHaveTextContent('лідер');
    expect(screen.getAllByText(/Це не фінансова порада/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Не допомогло' }));
    expect(sendFeedback).toHaveBeenCalledWith('d1', 'not_helped', '');
    expect(await screen.findByRole('textbox', { name: 'Що було не так?' })).toBeInTheDocument();
  });
});
