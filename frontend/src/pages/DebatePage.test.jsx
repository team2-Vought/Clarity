// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import DebatePage from './DebatePage';
import { createCustomRole, createDiscussion, fetchModels, fetchPersonas, fetchTeams } from '../api/discussions';
import { updatePreferences } from '../api/settings';
import { setMyProfile } from '../hooks/useMyProfile';
import { removeAttachment, uploadAttachment } from '../api/attachments';

vi.mock('../api/discussions', () => ({
  createCustomRole: vi.fn(),
  createDiscussion: vi.fn(),
  deleteTeam: vi.fn(),
  fetchModels: vi.fn(),
  fetchPersonas: vi.fn(),
  fetchTeams: vi.fn(),
  saveTeam: vi.fn(),
}));

vi.mock('../api/attachments', () => ({
  uploadAttachment: vi.fn(),
  removeAttachment: vi.fn(() => Promise.resolve()),
}));

vi.mock('../api/settings', () => ({
  updatePreferences: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal()),
  getSession: () => 'token',
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
  // без профілю: пігулки «Про мене» немає, поки він не завантажився
  setMyProfile({ name: 'Оксана', avatar: '' });
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

  it('заповнений «Про мене» можна вимкнути для однієї дискусії', async () => {
    const user = userEvent.setup();
    setMyProfile({ name: 'Оксана', about: { enabled: true, age: '25_34', values: ['family'] } });
    vi.mocked(createDiscussion).mockResolvedValue({ id: 'abc' });
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });

    // «Про мене» — перемикач у меню формату біля поля питання
    await user.click(screen.getByRole('button', { name: /^Формат відповіді й параметри:/ }));
    const toggle = screen.getByRole('menuitemcheckbox', { name: /^Враховувати «Про мене»/ });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.type(screen.getByRole('textbox', { name: 'Опис' }), 'Чи варто переходити на нову роботу?{Enter}');
    expect(vi.mocked(createDiscussion).mock.calls[0][0].useProfile).toBe(false);
  });

  it('порожній «Про мене» пропонує розповісти про себе', async () => {
    const user = userEvent.setup();
    vi.mocked(createDiscussion).mockResolvedValue({ id: 'abc' });
    setMyProfile({ name: 'Оксана', about: { enabled: true, age: '', values: [] } });
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });
    await user.click(screen.getByRole('button', { name: /^Формат відповіді й параметри:/ }));
    expect(
      screen.getByRole('menuitem', { name: 'Заповнити «Про мене»' })
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.type(screen.getByRole('textbox', { name: 'Опис' }), 'Чи варто переходити на нову роботу?{Enter}');
    // профілю немає — сервер вирішить сам
    expect(vi.mocked(createDiscussion).mock.calls[0][0].useProfile).toBeUndefined();
  });

  it('додає файли до питання й передає їх у дискусію', async () => {
    const user = userEvent.setup();
    let finish;
    vi.mocked(uploadAttachment).mockImplementationOnce(
      () => new Promise((resolve) => { finish = resolve; })
    );
    vi.mocked(uploadAttachment).mockResolvedValueOnce({ id: 'f2', name: 'flat.txt', kind: 'text' });
    vi.mocked(createDiscussion).mockResolvedValue({ id: 'abc' });
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });
    await user.type(screen.getByRole('textbox', { name: 'Опис' }), 'Чи варто погоджуватись на оффер?');

    const input = document.querySelector('input[type="file"]');
    await user.upload(input, new File(['%PDF'], 'offer.pdf', { type: 'application/pdf' }));
    // поки сервер читає файл, дискусію не створити
    expect(screen.getByText('offer.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Почати дискусію' })).toBeDisabled();
    finish({ id: 'f1', name: 'offer.pdf', kind: 'pdf' });

    // картку файлу можна відкрити й переглянути
    const open = screen.getByRole('button', { name: 'Переглянути «offer.pdf»' });
    await waitFor(() => expect(open).toBeEnabled());
    await user.click(open);
    // PDF показуємо самим файлом — сервер його не зберігає
    expect(within(screen.getByRole('dialog', { name: 'offer.pdf' })).getByTitle('offer.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Закрити' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.upload(input, new File(['x'], 'flat.txt', { type: 'text/plain' }));
    await user.click(await screen.findByRole('button', { name: 'Прибрати «flat.txt»' }));
    expect(removeAttachment).toHaveBeenCalledWith('f2');

    await user.click(screen.getByRole('button', { name: 'Почати дискусію' }));
    expect(vi.mocked(createDiscussion).mock.calls[0][0].attachments).toEqual(['f1']);
  });

  it('швидка відповідь і критерії вибору йдуть у запит на створення', async () => {
    const user = userEvent.setup();
    vi.mocked(createDiscussion).mockResolvedValue({ id: 'abc' });
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });

    await user.click(screen.getByRole('button', { name: /Формат відповіді/ }));
    // перемикач лишає меню відкритим, вибір формату — закриває
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Швидка відповідь/ }));
    // режими — у підменю рядка «Формат відповіді»
    await user.click(screen.getByRole('menuitem', { name: /^Формат відповіді/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /Один із варіантів/ }));
    const options = screen.getByRole('textbox', { name: 'Варіанти' });
    await user.type(options, 'Київ{Enter}Львів{Enter}');
    await user.type(screen.getByRole('textbox', { name: 'Критерії' }), 'Зарплата{Enter}');
    await user.click(screen.getByRole('radio', { name: 'Вага «Зарплата»: 5 з 5' }));

    await user.type(screen.getByRole('textbox', { name: 'Опис' }), 'Куди переїхати заради роботи?{Enter}');
    const payload = vi.mocked(createDiscussion).mock.calls[0][0];
    expect(payload.quick).toBe(true);
    expect(payload.criteria).toEqual([{ name: 'Зарплата', weight: 5 }]);
  });

  it('свою роль можна створити з меню ролі й одразу дати учаснику', async () => {
    const user = userEvent.setup();
    vi.mocked(createCustomRole).mockImplementation(async ({ name, description }) => ({
      id: 'r1', slug: 'c-abc', name, description,
    }));
    vi.mocked(createDiscussion).mockResolvedValue({ id: 'abc' });
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });

    await user.click(within(sheetOf('Логік')).getByRole('button', { name: 'Роль: Логік' }));
    await user.click(screen.getByRole('menuitem', { name: 'Створити свою роль' }));
    const dialog = screen.getByRole('dialog', { name: 'Своя роль' });
    await user.click(within(dialog).getByRole('button', { name: 'Юрист' }));
    await user.click(within(dialog).getByRole('button', { name: 'Створити' }));

    expect(createCustomRole).toHaveBeenCalledWith(expect.objectContaining({ name: 'Юрист' }));
    expect(await within(sheetOf('Юрист')).findByRole('button', { name: 'Роль: Юрист' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Опис' }), 'Чи підписувати цей договір оренди?{Enter}');
    expect(vi.mocked(createDiscussion).mock.calls[0][0].personas[0].slug).toBe('c-abc');
  });

  it('питання про кризу одразу показує, куди звернутися', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });
    expect(screen.queryByText('7333')).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Опис' }), 'Я не хочу більше жити');
    expect(screen.getByText('7333')).toBeInTheDocument();
  });

  it('тому, хто вже бачив підказки, їх не показує', async () => {
    vi.mocked(fetchModels).mockResolvedValue({
      models: MODELS,
      default_model: 'm1',
      recommended: [],
      preferences: { onboarding_done: true },
    });
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });
    expect(screen.queryByRole('region', { name: 'Вітаємо в Clarity' })).not.toBeInTheDocument();
  });

  it('показує склад жетонами, а зайняту роль у меню — недоступною з підказкою, хто її має', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Вибрати учасника «Емоційний»' })).toBeInTheDocument();

    await user.click(within(sheetOf('Логік')).getByRole('button', { name: 'Роль: Логік' }));
    const roles = screen.getByRole('menu', { name: 'Роль' });
    const taken = within(roles).getByRole('menuitemradio', { name: /Емоційний/ });
    expect(taken).toHaveAttribute('aria-disabled', 'true');
    expect(taken).toHaveAttribute('title', 'Цю роль уже має «Емоційний»');

    await user.click(taken);
    expect(within(sheetOf('Логік')).getByRole('button', { name: 'Роль: Логік' })).toBeInTheDocument();
  });

  it('зміна ролі оновлює анкету на місці, без перемонтування', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });
    const sheet = sheetOf('Логік');

    await user.click(within(sheet).getByRole('button', { name: 'Роль: Логік' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Скептик/ }));

    // безіменний учасник зветься назвою ролі — нова роль, нова назва, та сама анкета
    expect(sheetOf('Скептик')).toBe(sheet);
    expect(within(sheet).getByRole('button', { name: 'Роль: Скептик' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Роль: Скептик' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('формат відповіді обирається з меню біля поля питання', async () => {
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole('button', { name: /^Формат відповіді й параметри:/ });

    await user.click(button);
    // режими — у підменю рядка «Формат відповіді»
    await user.click(screen.getByRole('menuitem', { name: /^Формат відповіді/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /Один із варіантів/ }));

    expect(
      screen.getByRole('button', { name: 'Формат відповіді й параметри: Один із варіантів' })
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Варіанти' })).toBeInTheDocument();
  });

  it('пошук в інтернеті увімкнено в меню формату, а «Додатково» змінює раунди', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });

    await user.click(screen.getByRole('button', { name: /^Формат відповіді й параметри:/ }));
    expect(screen.getByRole('menuitemcheckbox', { name: /^Пошук в інтернеті/ })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: /^Додатково/ }));
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
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });

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
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });

    await user.click(screen.getByRole('button', { name: /^Додатково/ }));
    expect(screen.getByRole('radio', { name: 'До згоди' })).toHaveAttribute('aria-checked', 'true');
  });

  it('картка-підказка підставляє питання в поле, і підказки ховаються', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });

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

  it('вимкнені в налаштуваннях приклади запитів не показуються', async () => {
    localStorage.setItem('clarity:suggestions', 'off');
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });

    expect(screen.queryByRole('group', { name: 'Приклади питань' })).not.toBeInTheDocument();
  });

  it('Enter у полі створює дискусію без стилю й креативності та відкриває чат', async () => {
    const user = userEvent.setup();
    vi.mocked(createDiscussion).mockResolvedValue({ id: 'abc' });
    renderPage();
    await screen.findByRole('button', { name: 'Вибрати учасника «Логік»' });

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
