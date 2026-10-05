import { describe, expect, it } from 'vitest';
import { validateEmail, validatePassword } from './validate';

describe('validateEmail', () => {
  it('приймає коректні адреси', () => {
    expect(validateEmail('name@mail.com')).toBe(true);
    expect(validateEmail('  name@mail.com  ')).toBe(true);
    expect(validateEmail('a.b+tag@sub.domain.ua')).toBe(true);
  });

  it('відхиляє некоректні адреси', () => {
    expect(validateEmail('')).toBe(false);
    expect(validateEmail('name')).toBe(false);
    expect(validateEmail('name@')).toBe(false);
    expect(validateEmail('name@mail')).toBe(false);
    expect(validateEmail('na me@mail.com')).toBe(false);
  });
});

describe('validatePassword', () => {
  it('приймає надійний пароль', () => {
    expect(validatePassword('Tr7$k9!mQx2v')).toBeNull();
  });

  it('відхиляє порожній і короткий', () => {
    expect(validatePassword('')).toBeTruthy();
    expect(validatePassword('Ab1!')).toBeTruthy();
  });

  it('вимагає латинські літери', () => {
    expect(validatePassword('пароль123!@#')).toBeTruthy();
    expect(validatePassword('123456789!@')).toBeTruthy();
  });

  it('вимагає цифри або спецсимволи', () => {
    expect(validatePassword('Onlyletters')).toBeTruthy();
  });

  it('відхиляє слабкі та послідовності', () => {
    expect(validatePassword('password123!')).toBeTruthy();
    expect(validatePassword('Abc1234!!x')).toBeTruthy();
  });

  it('відхиляє недоступні символи', () => {
    expect(validatePassword('Valid123!№')).toBeTruthy();
  });
});
