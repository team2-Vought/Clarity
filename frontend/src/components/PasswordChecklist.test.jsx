// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PasswordChecklist } from './RegisterForm';
import { copy } from '../copy';

const v8n = copy.validation;
const renderHint = (password) =>
  render(
    <MemoryRouter>
      <PasswordChecklist password={password} />
    </MemoryRouter>
  );

describe('підказка до пароля', () => {
  it('до набору — одна коротка вимога', () => {
    renderHint('');
    expect(screen.getByText(v8n.passwordShortHint)).toBeTruthy();
  });

  it('під час набору — лише те, чого ще бракує', () => {
    renderHint('abc12345');
    expect(screen.getByText(v8n.passwordStillNeeded([v8n.passwordRules.special]))).toBeTruthy();
  });

  it('коли все виконано — галочка', () => {
    renderHint('abc12345!');
    expect(screen.getByText(v8n.passwordAllMet)).toBeTruthy();
  });
});
