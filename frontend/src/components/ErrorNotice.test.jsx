// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorNotice from './ErrorNotice';
import { discussionErrorKind, requestErrorKind } from '../utils/errorKind';

describe('ErrorNotice', () => {
  it('показує суть помилки заголовком, учасника — міткою, модель — жирним', async () => {
    const onClick = vi.fn();
    render(
      <ErrorNotice
        kind="quota"
        who
        text="Учасник 2: У моделі «Google Gemini — Gemini 3.8 Flash» вичерпано квоту."
        actions={[{ label: 'Змінити модель', onClick }]}
      />
    );

    expect(screen.getByRole('alert')).toHaveClass('notice--warn');
    expect(screen.getByText('Вичерпано ліміт моделі')).toBeTruthy();
    expect(screen.getByText('Учасник 2')).toHaveClass('notice__who');
    expect(screen.getByText('«Google Gemini — Gemini 3.8 Flash»').tagName).toBe('STRONG');

    await userEvent.click(screen.getByRole('button', { name: 'Змінити модель' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('стан без помилки озвучує як статус, а не тривогу', () => {
    render(<ErrorNotice kind="stopped" text="Натисніть «Продовжити», щоб завершити." />);
    expect(screen.getByRole('status')).toHaveClass('notice--neutral');
  });
});

describe('errorKind', () => {
  it('розрізняє квоту, ключ і збій моделі', () => {
    expect(discussionErrorKind('provider_quota')).toBe('quota');
    expect(discussionErrorKind('provider_config')).toBe('config');
    expect(discussionErrorKind('empty_response')).toBe('provider');
    expect(discussionErrorKind('щось нове')).toBe('generic');
  });

  it('розрізняє мережу, ліміт і сервер за статусом запиту', () => {
    expect(requestErrorKind({ status: 0 })).toBe('network');
    expect(requestErrorKind({ status: 429 })).toBe('limit');
    expect(requestErrorKind({ status: 502 })).toBe('server');
    expect(requestErrorKind({ status: 400 })).toBe('generic');
  });
});
