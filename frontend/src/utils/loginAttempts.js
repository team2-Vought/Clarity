const KEY = 'clarity_login_attempts';
export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 10 * 60 * 1000;

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* ignore (приватний режим тощо) */
  }
}

export function getAttempts() {
  const stored = read();
  const now = Date.now();
  if (stored.lockedUntil && stored.lockedUntil <= now) {
    write({ count: 0, lockedUntil: 0 });
    return { count: 0, left: MAX_ATTEMPTS, locked: false };
  }
  const count = stored.count || 0;
  return {
    count,
    left: Math.max(0, MAX_ATTEMPTS - count),
    locked: Boolean(stored.lockedUntil && stored.lockedUntil > now),
  };
}

export function recordFailure() {
  const { count } = getAttempts();
  const next = count + 1;
  const locked = next >= MAX_ATTEMPTS;
  write({ count: next, lockedUntil: locked ? Date.now() + LOCK_MS : 0 });
  return { count: next, left: Math.max(0, MAX_ATTEMPTS - next), locked };
}

export function resetAttempts() {
  write({ count: 0, lockedUntil: 0 });
}
