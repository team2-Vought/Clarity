
import { copy } from '../copy';

const t = copy.validation;
const ALLOWED = /^[A-Za-z0-9!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]+$/;
const WEAK = ['password', 'qwerty', 'admin', 'letmein', 'welcome', 'iloveyou', 'abc123'];

// Вимоги до пароля для живого чек-листа: людина бачить їх ще до відправки
export const passwordChecks = (pw = '') => [
  { key: 'length', met: pw.length >= 8 },
  { key: 'letter', met: /[A-Za-z]/.test(pw) },
  { key: 'digit', met: /[0-9]/.test(pw) },
  { key: 'special', met: /[^A-Za-z0-9]/.test(pw) },
];

export function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function validatePassword(pw) {
  if (!pw) return t.passwordShort;
  if (/[\p{L}]/u.test(pw.replace(/[A-Za-z]/g, ''))) return t.passwordLatinOnly;
  if (!ALLOWED.test(pw)) return t.passwordBadChar;
  if (pw.length < 8) return t.passwordShort;
  if (!/[A-Za-z]/.test(pw)) return t.passwordNoLetter;
  if (!/[0-9]/.test(pw)) return t.passwordNoDigit;
  if (!/[^A-Za-z0-9]/.test(pw)) return t.passwordNoSpecial;
  const lower = pw.toLowerCase();
  if (WEAK.some((w) => lower.includes(w)) || /^(.)\1+$/.test(pw) || /(0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/.test(lower)) {
    return t.passwordWeak;
  }
  return null;
}