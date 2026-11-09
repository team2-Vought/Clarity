import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { copy } from '../copy';
import { subscribeConfirm } from '../utils/confirm';

export default function ConfirmDialog() {
  const id = useId();
  const [request, setRequest] = useState(null);
  const confirmRef = useRef(null);

  useEffect(() => subscribeConfirm(setRequest), []);

  const close = useCallback(
    (result) => {
      request?.resolve(result);
      setRequest(null);
    },
    [request]
  );

  useEffect(() => {
    if (!request) return undefined;
    const previous = document.activeElement;
    confirmRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') close(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [request, close]);

  if (!request) return null;

  return (
    <div className="role-dialog__backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div
        className="role-dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={request.text ? `${id}-text` : undefined}
      >
        <h2 id={`${id}-title`} className="role-dialog__title">{request.title || copy.common.confirmTitle}</h2>
        {request.text && <p id={`${id}-text`} className="role-dialog__lead">{request.text}</p>}
        <div className="role-dialog__actions">
          <button type="button" className="role-dialog__button" onClick={() => close(false)}>
            {request.cancelLabel || copy.common.cancel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`role-dialog__button role-dialog__button--primary${request.danger ? ' role-dialog__button--danger' : ''}`}
            onClick={() => close(true)}
          >
            {request.confirmLabel || copy.common.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
