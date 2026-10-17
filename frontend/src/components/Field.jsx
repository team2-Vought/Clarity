import { useId, useState } from 'react';
import PropTypes from 'prop-types';
import { uk } from '../copy/uk';

const EyeIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M4 4l16 16" />}
  </svg>
);

EyeIcon.propTypes = {
  off: PropTypes.bool,
};

export default function Field({ label, type = 'text', error, hint, placeholder, ...inputProps }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field__box" data-invalid={error ? 'true' : undefined}>
        <input
          id={id}
          type={isPassword && visible ? 'text' : type}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={describedBy}
          placeholder={error || placeholder}
          {...inputProps}
        />
        {isPassword && (
          <button
            type="button"
            className="field__eye"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? uk.field.hidePassword : uk.field.showPassword}
            aria-pressed={visible}
          >
            <EyeIcon off={!visible} />
          </button>
        )}
      </div>
      {/* помилка живе в placeholder; для скрінрідерів — прихований текст */}
      {error && (
        <span className="sr-only" id={`${id}-err`}>
          {error}
        </span>
      )}
      {!error && hint && (
        <p className="field__msg" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

Field.propTypes = {
  label: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  type: PropTypes.string,
  error: PropTypes.string,
  hint: PropTypes.string,
  value: PropTypes.string,
  onChange: PropTypes.func,
  onBlur: PropTypes.func,
};