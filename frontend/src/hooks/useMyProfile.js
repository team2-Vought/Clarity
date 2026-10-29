import { useEffect, useSyncExternalStore } from 'react';
import { getToken } from '../api/client';
import { me } from '../api/auth';

// фото й ім'я поточного користувача — одні на весь застосунок;
// прив'язані до токена, щоб після входу в інший акаунт не лишилося чуже фото
const EMPTY = { avatar: '', name: '' };
let profile = EMPTY;
let loadedFor = null;
let pending = null;
const listeners = new Set();

const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => (loadedFor === getToken() ? profile : EMPTY);

/** Профіль змінив фото чи ім'я — чат підхоплює їх без перезавантаження. */
export function setMyProfile(user) {
  profile = { avatar: user?.avatar || '', name: user?.name || '' };
  loadedFor = getToken();
  notify();
}

function load() {
  const token = getToken();
  if (!token || loadedFor === token || pending) return;
  pending = me()
    .then((user) => {
      if (getToken() === token) setMyProfile(user);
    })
    .catch(() => {
      /* без профілю лишається іконка */
    })
    .finally(() => {
      pending = null;
    });
}

export function useMyProfile() {
  useEffect(load, []);
  return useSyncExternalStore(subscribe, snapshot);
}
