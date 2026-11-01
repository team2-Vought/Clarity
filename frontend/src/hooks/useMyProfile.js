import { useEffect, useSyncExternalStore } from 'react';
import { getSession } from '../api/client';
import { me } from '../api/auth';

// фото, ім'я й «Про мене» поточного користувача — одні на весь застосунок;
// прив'язані до токена, щоб після входу в інший акаунт не лишилося чуже фото.
// about — null, поки профіль не завантажився
const EMPTY = { avatar: '', name: '', about: null };
let profile = EMPTY;
let loadedFor = null;
let pending = null;
const listeners = new Set();

const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => (loadedFor === getSession() ? profile : EMPTY);

/** Профіль змінив фото, ім'я чи «Про мене» — сторінки підхоплюють це без перезавантаження. */
export function setMyProfile(user) {
  profile = { avatar: user?.avatar || '', name: user?.name || '', about: user?.about || null };
  loadedFor = getSession();
  notify();
}

function load() {
  const token = getSession();
  if (!token || loadedFor === token || pending) return;
  pending = me()
    .then((user) => {
      if (getSession() === token) setMyProfile(user);
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

/** Чи людина бодай щось розповіла про себе в «Про мене». */
export const hasAbout = (about) =>
  Boolean(about)
  && Object.entries(about).some(
    ([key, value]) => key !== 'enabled' && (Array.isArray(value) ? value.length > 0 : Boolean(value))
  );
