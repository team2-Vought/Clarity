import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { copy } from '../copy';

const t = copy.chat;

/** Перед публічним посиланням: що побачить будь-хто з ним і чи показувати особисте. */
export default function ShareDialog({ profileUsed = false, busy = false, onConfirm, onClose }) {
  const id = useId();
  // відповіді на уточнення й інші повідомлення автора — типово приховані
  const [personal, setPersonal] = useState(false);
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="role-dialog__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="role-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="role-dialog__title">{t.shareDialogTitle}</h2>
        <p className="role-dialog__lead">{t.shareDialogLead}</p>
        {profileUsed && <p className="role-dialog__lead share-dialog__warning">{t.shareDialogProfile}</p>}
        <label className="share-dialog__option">
          <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} disabled={busy} />
          <span>{t.shareDialogPersonal}</span>
        </label>
        <div className="role-dialog__actions">
          <button type="button" className="role-dialog__button" onClick={onClose} disabled={busy}>
            {t.shareDialogCancel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="role-dialog__button role-dialog__button--primary"
            onClick={() => onConfirm(personal)}
            disabled={busy}
          >
            {t.createShareLink}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

ShareDialog.propTypes = {
  profileUsed: PropTypes.bool,
  busy: PropTypes.bool,
  onConfirm: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
