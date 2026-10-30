import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { createCustomRole } from '../api/discussions';
import { copy } from '../copy';

const t = copy.debate;

/** Створення своєї ролі: назва й «хто це і як міркує»; ідеї заповнюють поля одним кліком. */
export default function CustomRoleDialog({ onCreated, onClose }) {
  const id = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onCreated(await createCustomRole({ name: name.trim(), description: description.trim() }));
    } catch (err) {
      const fields = err?.fieldErrors?.() || {};
      setError(fields.name || fields.description || err?.message || t.roleError);
      setBusy(false);
    }
  };

  return createPortal(
    <div className="role-dialog__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="role-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onSubmit={save}>
        <h2 id={`${id}-title`} className="role-dialog__title">{t.roleDialogTitle}</h2>
        <p className="role-dialog__lead">{t.roleDialogLead}</p>
        <div className="role-dialog__ideas" role="group" aria-label={t.roleIdeas}>
          {t.roleSuggestions.map((idea) => (
            <button
              key={idea.name}
              type="button"
              className="role-dialog__idea"
              onClick={() => {
                setName(idea.name);
                setDescription(idea.description);
              }}
            >
              {idea.name}
            </button>
          ))}
        </div>
        <label className="role-dialog__label" htmlFor={`${id}-name`}>{t.roleName}</label>
        <input
          ref={nameRef}
          id={`${id}-name`}
          className="role-dialog__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.roleNamePlaceholder}
          maxLength={40}
          disabled={busy}
        />
        <label className="role-dialog__label" htmlFor={`${id}-description`}>{t.roleDescription}</label>
        <textarea
          id={`${id}-description`}
          className="role-dialog__input role-dialog__input--area"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t.roleDescriptionPlaceholder}
          maxLength={400}
          rows={3}
          disabled={busy}
        />
        {error && <p className="role-dialog__error" role="alert">{error}</p>}
        <div className="role-dialog__actions">
          <button type="button" className="role-dialog__button" onClick={onClose} disabled={busy}>
            {t.roleCancel}
          </button>
          <button
            type="submit"
            className="role-dialog__button role-dialog__button--primary"
            disabled={busy || name.trim().length < 2 || description.trim().length < 10}
          >
            {busy ? t.roleSaving : t.roleSave}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

CustomRoleDialog.propTypes = {
  onCreated: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
