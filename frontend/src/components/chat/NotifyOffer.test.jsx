// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotifyOffer from './NotifyOffer';
import { useNotifyPrefs } from '../../hooks/useNotifyPrefs';

vi.mock('../../hooks/useNotifyPrefs', () => ({ useNotifyPrefs: vi.fn() }));

const setSystem = vi.fn();

beforeEach(() => {
  localStorage.clear();
  setSystem.mockReset();
  vi.mocked(useNotifyPrefs).mockReturnValue({ system: false, permission: 'default', setSystem });
});

describe('NotifyOffer', () => {
  it('пропонує сповістити й просить дозвіл лише після натискання', async () => {
    const user = userEvent.setup();
    render(<NotifyOffer />);
    expect(setSystem).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Сповістити, коли буде готово/ }));
    expect(setSystem).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('button', { name: /Сповістити/ })).not.toBeInTheDocument();
  });

  it('після «Не треба» більше не з’являється', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<NotifyOffer />);
    await user.click(screen.getByRole('button', { name: 'Не треба' }));
    expect(setSystem).not.toHaveBeenCalled();
    unmount();

    render(<NotifyOffer />);
    expect(screen.queryByRole('button', { name: /Сповістити/ })).not.toBeInTheDocument();
  });

  it('не пропонує, якщо браузер заборонив сповіщення', () => {
    vi.mocked(useNotifyPrefs).mockReturnValue({ system: false, permission: 'denied', setSystem });
    render(<NotifyOffer />);
    expect(screen.queryByRole('button', { name: /Сповістити/ })).not.toBeInTheDocument();
  });
});
