import { createContext, useContext } from 'react';

export const ToastsContext = createContext(null);

export function useToasts() {
  const ctx = useContext(ToastsContext);
  if (!ctx) throw new Error('useToasts має використовуватись всередині <ToastProvider>');
  return ctx;
}
