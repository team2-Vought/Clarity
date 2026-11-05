// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BugReportDialog from './BugReportDialog';
import { sendBugReport } from '../api/support';
import { openBugReport } from '../utils/bugReport';
import { recordError, resetDiagnostics } from '../utils/diagnostics';

vi.mock('../api/support', () => ({ sendBugReport: vi.fn() }));
vi.mock('../api/auth', () => ({ me: vi.fn(() => Promise.resolve({ email: 'me@test.com' })) }));

HTMLDialogElement.prototype.showModal ??= function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function close() {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

const open = (detail) => act(() => openBugReport(detail));

describe('«Знайшли баги?»', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDiagnostics();
    sendBugReport.mockReset();
  });

  it('не надсилає надто короткий опис і пояснює чому', async () => {
    render(<BugReportDialog />);
    open();
    await userEvent.type(screen.getByLabelText('Опишіть докладніше'), 'баг');
    await userEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
    expect(sendBugReport).not.toHaveBeenCalled();
    expect(screen.getByText(/хоча б 10 символів/)).toBeInTheDocument();
  });

  it('гість надсилає звернення з поштою й технічними даними та бачить номер', async () => {
    recordError('api', 'GET /api/x → 500');
    sendBugReport.mockResolvedValue({ reference: 'AB12CD34' });
    render(<BugReportDialog />);
    open({ kind: 'idea' });

    expect(screen.getByRole('radio', { name: 'Ідея' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.type(screen.getByLabelText('Опишіть докладніше'), 'Додайте темну тему на лендинг');
    await userEvent.type(screen.getByLabelText(/Пошта для відповіді/), 'guest@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

    const payload = sendBugReport.mock.calls[0][0];
    expect(payload.kind).toBe('idea');
    expect(payload.email).toBe('guest@example.com');
    expect(payload.context.errors[0].message).toBe('GET /api/x → 500');
    expect(payload.discussion).toBeNull();
    expect(await screen.findByText('Номер звернення: #AB12CD34')).toBeInTheDocument();
  });

  it('технічні дані можна не додавати', async () => {
    sendBugReport.mockResolvedValue({ reference: 'X' });
    render(<BugReportDialog />);
    open();
    await userEvent.type(screen.getByLabelText('Опишіть докладніше'), 'Кнопка не реагує на натискання');
    await userEvent.click(screen.getByRole('checkbox', { name: /Додати технічні дані/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
    expect(sendBugReport.mock.calls[0][0].context).toEqual({});
  });

  it('показує помилку сервера й не губить опис', async () => {
    sendBugReport.mockRejectedValue(new Error('Забагато звернень'));
    render(<BugReportDialog />);
    open();
    const area = screen.getByLabelText('Опишіть докладніше');
    await userEvent.type(area, 'Сторінка історії не відкривається');
    await userEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Забагато звернень');
    expect(area).toHaveValue('Сторінка історії не відкривається');
  });
});
