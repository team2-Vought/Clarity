import { useEffect, useSyncExternalStore } from 'react';
import { getToken } from '../api/client';
import { fetchJournalDue } from '../api/journal';

// Рішення, що чекають на «Як воно?», — одні на весь застосунок: значок у меню
// й картка на головній. Оновлюються при переходах і після підсумку.
const EMPTY = { count: 0, next: null };
let state = EMPTY;
let loadedFor = null;
let pending = null;
const listeners = new Set();

const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => (loadedFor === getToken() ? state : EMPTY);

/** Перечитати з сервера: після підсумку, «ще рано» чи нового запису. */
export function refreshJournalDue() {
  const token = getToken();
  if (!token || pending) return pending;
  pending = fetchJournalDue()
    .then((data) => {
      if (getToken() !== token) return;
      state = { count: data?.count || 0, next: data?.next || null };
      loadedFor = token;
      notify();
    })
    .catch(() => {
      /* без журналу просто немає значка */
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function useJournalDue() {
  useEffect(() => {
    refreshJournalDue();
  }, []);
  return useSyncExternalStore(subscribe, snapshot);
}
