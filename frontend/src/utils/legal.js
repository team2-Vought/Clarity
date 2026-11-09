import { copy, lang } from '../copy';

const OPERATOR_FALLBACK = { uk: 'команда Clarity', en: 'the Clarity team' };

/** Хто керує сервісом і куди писати — з env збірки, щоб не вшивати адресу в код. */
export function legalContact() {
  const env = import.meta.env || {};
  const operator = String(env.VITE_LEGAL_OPERATOR || '').trim() || OPERATOR_FALLBACK[lang];
  const email = String(env.VITE_CONTACT_EMAIL || '').trim();
  return { operator, contact: email ? copy.legal.contactEmail(email) : copy.legal.contactFallback, email };
}
