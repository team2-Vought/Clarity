import { request } from './client';

/** Налаштування акаунта: параметри нової дискусії, провайдери з ключами, ліміти. */
export function fetchSettings() {
  return request('/api/settings/', { auth: true });
}

export function updatePreferences(preferences) {
  return request('/api/settings/', { method: 'PATCH', auth: true, body: { preferences } });
}

/** Ключ перевіряється на сервері запитом до провайдера; у відповіді `verified`. */
export function saveProviderKey(provider, key) {
  return request(`/api/settings/keys/${provider}/`, { method: 'PUT', auth: true, body: { key } });
}

export function deleteProviderKey(provider) {
  return request(`/api/settings/keys/${provider}/`, { method: 'DELETE', auth: true });
}
