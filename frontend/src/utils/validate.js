
const ALLOWED = /^[A-Za-z0-9!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]+$/;
const WEAK = ['password', 'qwerty', 'admin', 'letmein', 'welcome', 'iloveyou', 'abc123'];

export const PASSWORD_HINT =
  '*пароль має містити щонайменше 8 символів, включно з латинськими літерами, цифрами та спец. символами';

export function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function validatePassword(pw) {
  if (!pw) return 'Занадто короткий пароль';
  if (/[\p{L}]/u.test(pw.replace(/[A-Za-z]/g, ''))) return 'Використовуйте лише латинські літери';
  if (!ALLOWED.test(pw)) return 'Один з символів не є доступним';
  if (pw.length < 8) return 'Занадто короткий пароль';
  if (!/[A-Za-z]/.test(pw)) return 'Пароль має містити латинські літери';
  if (!/[0-9]/.test(pw)) return 'Додайте цифри';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Додайте спец. символи';
  const lower = pw.toLowerCase();
  if (WEAK.some((w) => lower.includes(w)) || /^(.)\1+$/.test(pw) || /(0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/.test(lower)) {
    return 'Цей пароль не виглядає надійним';
  }
  return null;
}