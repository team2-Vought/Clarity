import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert02Icon,
  Cancel01Icon,
  InformationCircleIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { ToastsContext, useToasts } from '../hooks/useToasts';
import { copy } from '../copy';

const ICONS = { error: Alert02Icon, success: Tick02Icon, info: InformationCircleIcon };
// стільки триває анімація зникнення, перш ніж тост прибирається з розмітки
const LEAVE_MS = 200;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const closeToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // kind: 'error' (за замовчуванням — більшість тостів про невдачі), 'success' чи 'info'
  const pushToast = useCallback((text, kind = 'error') => {
    setToasts((t) => (t.some((x) => x.text === text) ? t : [...t, { id: Date.now() + Math.random(), text, kind }]));
  }, []);

  const value = useMemo(() => ({ toasts, pushToast, closeToast }), [toasts, pushToast, closeToast]);

  return (
    <ToastsContext.Provider value={value}>
      {children}
      <ToastStack />
    </ToastsContext.Provider>
  );
}

ToastProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

function ToastItem({ toast, onClose }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  // довші повідомлення (перелік помилок) тримаємо довше
  const duration = 4500 + Math.min(toast.text.length * 20, 4000);
  // скільки лишилося показувати: наведення ставить відлік на паузу
  const remaining = useRef(duration);

  const leave = useCallback(() => {
    setLeaving(true);
    setTimeout(() => onClose(toast.id), LEAVE_MS);
  }, [onClose, toast.id]);

  useEffect(() => {
    if (paused || leaving) return undefined;
    const started = Date.now();
    const timer = setTimeout(leave, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, leaving, leave]);

  const kind = ICONS[toast.kind] ? toast.kind : 'error';
  return (
    <div
      className={`toast toast--${kind} ${leaving ? 'toast--leaving' : ''}`}
      role={kind === 'error' ? 'alert' : 'status'}
      style={{ '--toast-duration': `${duration}ms` }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="toast__icon" aria-hidden="true">
        <HugeiconsIcon icon={ICONS[kind]} size={16} strokeWidth={2} />
      </span>
      <p>{toast.text}</p>
      <button type="button" className="toast__close" onClick={leave} aria-label={copy.common.close}>
        <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
      </button>
      {/* скільки ще видно тост; на наведенні зупиняється разом із таймером */}
      <span className={`toast__timer ${paused ? 'toast__timer--paused' : ''}`} aria-hidden="true" />
    </div>
  );
}

ToastItem.propTypes = {
  toast: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    text: PropTypes.string.isRequired,
    kind: PropTypes.oneOf(['error', 'success', 'info']),
  }).isRequired,
  onClose: PropTypes.func.isRequired,
};

function ToastStack() {
  const { toasts, closeToast } = useToasts();
  // Портал у body: інакше backdrop-filter картки робить position: fixed
  // відносним картки, а не всього екрана
  return createPortal(
    <div className="toasts">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={closeToast} />
      ))}
    </div>,
    document.body,
  );
}
