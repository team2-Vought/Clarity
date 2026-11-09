// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LegalPage from './LegalPage';

const renderDoc = (doc) =>
  render(
    <MemoryRouter>
      <LegalPage doc={doc} />
    </MemoryRouter>
  );

describe('LegalPage', () => {
  it('Політика: заголовок, розділи, посилання на Умови й назва вкладки', () => {
    renderDoc('privacy');
    expect(screen.getByRole('heading', { level: 1, name: 'Політика конфіденційності' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Хто ще отримує дані' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Умови користування' })).toHaveAttribute('href', '/terms');
    expect(document.title).toBe('Політика конфіденційності · Clarity');
  });

  it('без контакту в збірці відсилає до форми «Знайшли баги?»', () => {
    renderDoc('terms');
    expect(screen.getByRole('heading', { level: 1, name: 'Умови користування' })).toBeInTheDocument();
    expect(screen.getAllByText(/формою «Знайшли баги\?»/).length).toBeGreaterThan(0);
  });
});
