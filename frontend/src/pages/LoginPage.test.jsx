// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import LoginPage from './LoginPage';
import RegisterPage from './RegisterPage';
import { googleConfig } from '../api/auth';

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
