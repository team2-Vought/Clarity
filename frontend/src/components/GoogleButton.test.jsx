// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from './Toast';
import GoogleButton from './GoogleButton';
import { googleConfig, googleLogin } from '../api/auth';

vi.mock('../api/auth', () => ({
  googleConfig: vi.fn(),
  googleLogin: vi.fn(),
}));

let tokenClient;

beforeEach(() => {
  tokenClient = null;
  // бібліотека Google уже «завантажена»: кнопка бере її з window
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: vi.fn((config) => {
          tokenClient = { config, requestAccessToken: vi.fn() };
          return tokenClient;
        }),
      },
    },
  };
  vi.mocked(googleConfig).mockReset();
  vi.mocked(googleLogin).mockReset();
});

afterEach(() => {
  delete window.google;
});

const renderButton = (props = {}) =>
  render(
    <ToastProvider>
      <GoogleButton {...props} />
    </ToastProvider>
  );

describe('GoogleButton', () => {
  it('без налаштованого Google кнопки немає', async () => {
    vi.mocked(googleConfig).mockResolvedValue({ client_id: '' });
    renderButton();
    await waitFor(() => expect(googleConfig).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();
  });

  it('вікно Google відкривається з кліку, а токен іде на сервер', async () => {
    const user = userEvent.setup();
    const onSignedIn = vi.fn();
    vi.mocked(googleConfig).mockResolvedValue({ client_id: 'client-123' });
    vi.mocked(googleLogin).mockResolvedValue({ token: 't', created: true });
    renderButton({ onSignedIn });

    const button = await screen.findByRole('button', { name: 'Продовжити з Google' });
    await waitFor(() => expect(tokenClient).not.toBeNull());
    expect(tokenClient.config.client_id).toBe('client-123');

    await user.click(button);
    expect(tokenClient.requestAccessToken).toHaveBeenCalledTimes(1);

    await tokenClient.config.callback({ access_token: 'access-abc' });
    expect(googleLogin).toHaveBeenCalledWith('access-abc');
    expect(onSignedIn).toHaveBeenCalledWith({ token: 't', created: true });
  });

  it('закрите вікно Google повертає кнопку й пояснює це', async () => {
    const user = userEvent.setup();
    vi.mocked(googleConfig).mockResolvedValue({ client_id: 'client-123' });
    renderButton();
    const button = await screen.findByRole('button', { name: 'Продовжити з Google' });
    await waitFor(() => expect(tokenClient).not.toBeNull());

    await user.click(button);
    tokenClient.config.error_callback({ type: 'popup_closed' });
    expect(await screen.findByText('Вікно Google закрилося до входу')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продовжити з Google' })).toBeEnabled();
  });
});
