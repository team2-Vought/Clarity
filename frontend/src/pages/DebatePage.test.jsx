// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import DebatePage from './DebatePage';
import { createDiscussion, fetchModels, fetchPersonas, fetchTeams } from '../api/discussions';
import { updatePreferences } from '../api/settings';

vi.mock('../api/discussions', () => ({
  createDiscussion: vi.fn(),
  deleteTeam: vi.fn(),
  fetchModels: vi.fn(),
  fetchPersonas: vi.fn(),
  fetchTeams: vi.fn(),
  saveTeam: vi.fn(),
}));

vi.mock('../api/settings', () => ({
  updatePreferences: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal()),
  getToken: () => 'token',
}));

const PERSONAS = [
  { slug: 'logician', name: 'Логік', description: 'Тримається фактів.' },
  { slug: 'emotional', name: 'Емоційний', description: 'Говорить відверто.' },
  { slug: 'skeptic', name: 'Скептик', description: 'Ставить під сумнів.' },
  { slug: 'pragmatist', name: 'Прагматик', description: 'Думає про результат.' },
  { slug: 'creative', name: 'Креативник', description: 'Шукає нестандартне.' },
];

const MODELS = [
  { id: 'm1', provider: 'Provider', label: 'Model One', available: true },
  { id: 'm2', provider: 'Provider', label: 'Model Two', available: true },
];

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<DebatePage />} />
          <Route path="/chat/:id" element={<p>Сторінка чату</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );

const sheetOf = (name) => screen.getByRole('region', { name: `Налаштування учасника «${name}»` });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetchPersonas).mockResolvedValue({
    personas: PERSONAS,
    max_ai: 5,
    max_rounds: 3,
    search: { available: true, provider: 'Wikipedia', limited: true },
  });
  vi.mocked(fetchModels).mockResolvedValue({ models: MODELS, default_model: 'm1', recommended: [] });
  vi.mocked(fetchTeams).mockResolvedValue({ results: [] });
  vi.mocked(createDiscussion).mockReset();
});

describe('DebatePage', () => {
  it('новачку показує підказки першого запуску й запам’ятовує, що їх закрито', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchModels).mockResolvedValue({
      models: MODELS,
      default_model: 'm1',
      recommended: [],
      preferences: { onboarding_done: false },
    });
    renderPage();
    const card = await screen.findByRole('region', { name: 'Вітаємо в Clarity' });
    expect(within(card).getAllByRole('listitem')).toHaveLength(3);

    await user.click(within(card).getByRole('button', { name: 'Зрозуміло' }));
    expect(screen.queryByRole('region', { name: 'Вітаємо в Clarity' })).not.toBeInTheDocument();
    expect(updatePreferences).toHaveBeenCalledWith({ onboarding_done: true });
  });

  it('тому, хто вже бачив підказки, їх не показує', async () => {
    vi.mocked(fetchModels).mockResolvedValue({
      models: MODELS,
      default_model: 'm1',
      recommended: [],
      preferences: { onboarding_done: true },
    });
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' });
    expect(screen.queryByRole('region', { name: 'Вітаємо в Clarity' })).not.toBeInTheDocument();
  });

  it('показує склад жетонами, а зайняту роль у меню — недоступною з підказкою, хто її має', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Вибрати учасника «Учасник 2»' })).toBeInTheDocument();

    await user.click(within(sheetOf('Учасник 1')).getByRole('button', { name: 'Роль: Логік' }));
    const roles = screen.getByRole('menu', { name: 'Роль' });
    const taken = within(roles).getByRole('menuitemradio', { name: /Емоційний/ });
    expect(taken).toHaveAttribute('aria-disabled', 'true');
    expect(taken).toHaveAttribute('title', 'Цю роль уже має «Учасник 2»');

    await user.click(taken);
    expect(within(sheetOf('Учасник 1')).getByRole('button', { name: 'Роль: Логік' })).toBeInTheDocument();
  });

  it('зміна ролі оновлює анкету на місці, без перемонтування', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' });
    const sheet = sheetOf('Учасник 1');

    await user.click(within(sheet).getByRole('button', { name: 'Роль: Логік' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Скептик/ }));

    expect(sheetOf('Учасник 1')).toBe(sheet);
    expect(within(sheet).getByRole('button', { name: 'Роль: Скептик' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Роль: Скептик' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('формат відповіді обирається з меню біля поля питання', async () => {
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole('button', { name: /^Формат відповіді:/ });

    await user.click(button);
    await user.click(screen.getByRole('menuitemradio', { name: /Один із варіантів/ }));

    expect(screen.getByRole('button', { name: 'Формат відповіді: Один із варіантів' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Варіанти' })).toBeInTheDocument();
  });

  it('«Додатково» — окремий екран: пошук увімкнено, раунди змінюються', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' });

    await user.click(screen.getByRole('button', { name: /^Додатково/ }));
    expect(screen.getByRole('switch', { name: 'Пошук в інтернеті' })).toBeChecked();
    // одного раунду замало для дискусії — такого варіанта немає
    expect(screen.queryByRole('radio', { name: '1 раунд' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '3 раунди' }));
    expect(screen.getByRole('radio', { name: '3 раунди' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('button', { name: 'Назад' }));
    // вибір зберігається, коли повертаємося на екран знову
    await user.click(screen.getByRole('button', { name: 'Додатково' }));
    expect(screen.getByRole('radio', { name: '3 раунди' })).toHaveAttribute('aria-checked', 'true');
  });

  it('«До згоди» замінює кількість раундів і йде в запит на створення', async () => {
    const user = userEvent.setup();
    vi.mocked(createDiscussion).mockResolvedValue({ id: 'abc' });
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' });

    await user.click(screen.getByRole('button', { name: /^Додатково/ }));
    await user.click(screen.getByRole('radio', { name: 'До згоди' }));
    expect(screen.getByRole('radio', { name: 'До згоди' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '2 раунди' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/доки всі не дійдуть одного висновку/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Назад' }));
    await user.type(screen.getByRole('textbox', { name: 'Опис' }), 'Чи варто переходити на нову роботу?{Enter}');
    expect(vi.mocked(createDiscussion).mock.calls[0][0].untilConsensus).toBe(true);
  });

  it('налаштування «До згоди» за замовчуванням одразу вибране', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchModels).mockResolvedValue({
      models: MODELS,
      default_model: 'm1',
      recommended: [],
      preferences: { default_until_consensus: true },
    });
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' });

    await user.click(screen.getByRole('button', { name: /^Додатково/ }));
    expect(screen.getByRole('radio', { name: 'До згоди' })).toHaveAttribute('aria-checked', 'true');
  });

  it('картка-підказка підставляє питання в поле, і підказки ховаються', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' });

    const group = screen.getByRole('group', { name: 'Приклади питань' });
    const card = within(group).getAllByRole('button')[0];
    const text = card.querySelector('.debate__suggestion-text').textContent;
    await user.click(card);

    const field = screen.getByRole('textbox', { name: 'Опис' });
    expect(field).toHaveValue(text);
    expect(field).toHaveFocus();
    // блок лишається в розмітці, щоб згорнутися плавно, але вже недоступний
    expect(group.closest('.debate__reveal')).not.toHaveClass('debate__reveal--open');
    expect(group.closest('.debate__reveal')).toHaveAttribute('inert');
  });

  it('Enter у полі створює дискусію без стилю й креативності та відкриває чат', async () => {
    const user = userEvent.setup();
    vi.mocked(createDiscussion).mockResolvedValue({ id: 'abc' });
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Учасник 1»' });

    await user.type(screen.getByRole('textbox', { name: 'Опис' }), 'Чи варто переходити на нову роботу?{Enter}');

    expect(createDiscussion).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(createDiscussion).mock.calls[0][0];
    expect(payload.webSearch).toBe(true);
    expect(payload.personas).toHaveLength(2);
    payload.personas.forEach((persona) => {
      expect(persona).not.toHaveProperty('style');
      expect(persona).not.toHaveProperty('temperature');
    });
    expect(await screen.findByText('Сторінка чату')).toBeInTheDocument();
  });
});
