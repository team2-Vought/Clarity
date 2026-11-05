import { request } from './client';

/** Звернення «Знайшли баги?»; повертає { reference } — короткий номер звернення. */
export function sendBugReport({
  kind,
  description,
  page,
  email = '',
  replyToAccount = false,
  discussion = null,
  message = null,
  context = {},
  website = '',
}) {
  return request('/api/support/reports/', {
    method: 'POST',
    // гостям теж можна; cookie входу, якщо він є, підкаже, хто пише
    body: {
      kind,
      description,
      page,
      email,
      reply_to_account: replyToAccount,
      discussion,
      message,
      context,
      website,
    },
  });
}
