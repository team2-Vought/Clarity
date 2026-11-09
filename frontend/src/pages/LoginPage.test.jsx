// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import LoginPage from './LoginPage';
import RegisterPage from './RegisterPage';
import userEvent from '@testing-library/user-event';
import { googleConfig, register } from '../api/auth';

vi.mock('../api/auth', () => ({
  googleConfig: vi.fn(),
  googleLogin: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
}));

beforeEach(() => {
  window.google = { accounts: { oauth2: { initTokenClient: vi.fn(() => ({ requestAccessToken: vi.fn() })) } } };
  vi.mocked(googleConfig).mockReset();
});

afterEach(() => {
  delete window.google;
});

const renderPage = (Page) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Page />
      </ToastProvider>
    </MemoryRouter>
  );

describe('«Продовжити з Google» на сторінках входу', () => {
  it.each([
    ['вхід', LoginPage],
    ['реєстрація', RegisterPage],
  ])('%s: кнопка є, коли Google налаштовано', async (_, Page) => {
    vi.mocked(googleConfig).mockResolvedValue({ client_id: 'client-123' });
    renderPage(Page);
    expect(await screen.findByRole('button', { name: 'Продовжити з Google' })).toBeInTheDocument();
  });

  it('без GOOGLE_CLIENT_ID на сервері кнопки немає й на вході', async () => {
    vi.mocked(googleConfig).mockResolvedValue({ client_id: '' });
    renderPage(LoginPage);
    await waitFor(() => expect(googleConfig).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();
  });
});

describe('Згода з Умовами під час реєстрації', () => {
  it('без позначки форма не надсилається й пояснює чому', async () => {
    const user = userEvent.setup();
    vi.mocked(googleConfig).mockResolvedValue({ client_id: '' });
    vi.mocked(register).mockReset();
    renderPage(RegisterPage);
    await user.type(screen.getByPlaceholderText('Як до вас звертатися'), 'Оля');
    await user.type(screen.getByPlaceholderText('name@mail.com'), 'olya@test.com');
    await user.type(screen.getByPlaceholderText('Створіть пароль'), 'pass123!A');
    await user.type(screen.getByPlaceholderText('Введіть пароль ще раз'), 'pass123!A');
    await user.click(screen.getByRole('button', { name: 'Створити' }));
    expect(register).not.toHaveBeenCalled();
    expect(screen.getAllByText(/прийміть Умови/).length).toBeGreaterThan(0);
  });

  it('посилання ведуть на Умови й Політику конфіденційності', async () => {
    vi.mocked(googleConfig).mockResolvedValue({ client_id: '' });
    renderPage(RegisterPage);
    expect(screen.getAllByRole('link', { name: 'Умови користування' })[0]).toHaveAttribute('href', '/terms');
    expect(screen.getAllByRole('link', { name: 'Політику конфіденційності' })[0]).toHaveAttribute('href', '/privacy');
  });
});
