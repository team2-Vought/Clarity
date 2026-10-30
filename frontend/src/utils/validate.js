
import { copy } from '../copy';

const t = copy.validation;
const ALLOWED = /^[A-Za-z0-9!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]+$/;
const WEAK = ['password', 'qwerty', 'admin', 'letmein', 'welcome', 'iloveyou', 'abc123'];

export const PASSWORD_HINT = t.passwordHint;

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