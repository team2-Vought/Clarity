import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { ToastsContext, useToasts } from '../hooks/useToasts';
import { uk } from '../copy/uk';

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const closeToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const pushToast = useCallback((text) => {
    setToasts((t) => (t.some((x) => x.text === text) ? t : [...t, { id: Date.now() + Math.random(), text }]));
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
  useEffect(() => {
    const t = setTimeout(() => onClose(toast.id), 4500);
    return () => clearTimeout(t);
  }, [toast.id, onClose]);

  return (
    <div className="toast" role="alert">
      <span className="toast__dot" aria-hidden="true" />
      <p>{toast.text}</p>
      <button type="button" className="toast__close" onClick={() => onClose(toast.id)} aria-label={uk.common.close}>
        ×
      </button>
    </div>
  );
}

ToastItem.propTypes = {
  toast: PropTypes.shape({ id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired, text: PropTypes.string.isRequired }).isRequired,
  onClose: PropTypes.func.isRequired,
};

function ToastStack() {
  const { toasts, closeToast } = useToasts();
  // Портал у body: інакше backdrop-filter картки робить position: fixed
  // відносним картки, а не всього екрана
  return createPortal(
    <div className="toasts" aria-live="assertive">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={closeToast} />
      ))}
    </div>,
    document.body,
  );
}
