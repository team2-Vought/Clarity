// Вид картки помилки (див. components/ErrorNotice): за кодом сервера чи статусом запиту

/** Код помилки дискусії з сервера → вид картки. */
export function discussionErrorKind(code) {
  switch (code) {
    case 'provider_quota':
      return 'quota';
    case 'provider_config':
      return 'config';
    case 'provider_error':
    case 'empty_response':
      return 'provider';
    case 'daily_limit':
      return 'limit';
    case 'followup_limit':
      return 'followups';
    case 'internal_error':
      return 'server';
    default:
      return 'generic';
  }
}

/** Помилка запиту (ApiError) → вид картки. */
export function requestErrorKind(err) {
  if (err?.status === 0) return 'network';
  if (err?.status === 429) return 'limit';
  if (err?.status >= 500) return 'server';
  return 'generic';
}
