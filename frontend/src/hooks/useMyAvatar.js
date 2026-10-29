import { useEffect, useSyncExternalStore } from 'react';
import { getToken } from '../api/client';
import { me } from '../api/auth';

// аватарка поточного користувача — одна на весь застосунок;
// прив'язана до токена, щоб після входу в інший акаунт не лишилося чуже фото
let avatar = '';
let loadedFor = null;
let pending = null;
const listeners = new Set();

const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => (loadedFor === getToken() ? avatar : '');

/** Профіль змінив фото — чат підхоплює його без перезавантаження. */
export function setMyAvatar(value) {
  avatar = value || '';
  loadedFor = getToken();
  notify();
}

function load() {
  const token = getToken();
  if (!token || loadedFor === token || pending) return;
  pending = me()
    .then((user) => {
      if (getToken() === token) setMyAvatar(user?.avatar);
    })
    .catch(() => {
      /* без фото лишається іконка */
    })
    .finally(() => {
      pending = null;
    });
}

export function useMyAvatar() {
  useEffect(load, []);
  return useSyncExternalStore(subscribe, snapshot);
}
