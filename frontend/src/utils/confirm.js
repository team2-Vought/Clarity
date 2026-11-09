// Підтвердження дії у стилі платформи замість системного window.confirm():
// той виглядав по-різному в кожному браузері й не знав про тему та мову.
const listeners = new Set();

/** Для <ConfirmDialog />: отримувати запити на підтвердження. Повертає відписку. */
export function subscribeConfirm(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Питає підтвердження: `await confirmAction({ text, confirmLabel, danger })` → true / false.
 * Діалог малює <ConfirmDialog />, змонтований один раз у App.
 */
export function confirmAction(options) {
  return new Promise((resolve) => {
    if (listeners.size === 0) {
      resolve(false);
      return;
    }
    listeners.forEach((listener) => listener({ ...options, resolve }));
  });
}
