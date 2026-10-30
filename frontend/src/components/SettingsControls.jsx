import { useId } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';

// Будівельні блоки сторінки «Налаштування»: пігулки, рядок і рядок-перемикач

/** Пігулки-перемикачі — як раунди й вигляд чату на панелі нового чату. */
export function Pills({
  label,
  value,
  options,
  onChange,
  disabled = false,
  fill = false,
  clearable = false,
}) {
  return (
    <div
      className={`settings__pills ${fill ? 'settings__pills--fill' : ''}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`settings__pill ${active ? 'settings__pill--active' : ''}`}
            // необов'язковий вибір знімається повторним кліком
            onClick={() => (active ? clearable && onChange('') : onChange(option.value))}
            disabled={disabled}
          >
            {option.icon && <HugeiconsIcon icon={option.icon} size={16} aria-hidden="true" />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// `wide` — елемент керування переноситься під підпис, коли не вміщається;
// `stacked` — завжди під підписом на всю ширину картки
export function Row({ title, hint, children, wide = false, stacked = false }) {
  const modifier = stacked ? 'settings__row--stacked' : wide ? 'settings__row--wide' : '';
  return (
    <div className={`settings__row ${modifier}`}>
      <div className="settings__row-text">
        <span className="settings__row-title">{title}</span>
        {hint && <span className="settings__row-hint">{hint}</span>}
      </div>
      <div className="settings__row-control">{children}</div>
    </div>
  );
}

export function SwitchRow({ title, hint, checked, onChange, disabled = false }) {
  const id = useId();
  return (
    <label className="settings__row settings__row--switch" htmlFor={id}>
      <span className="settings__row-text">
        <span className="settings__row-title">{title}</span>
        {hint && <span className="settings__row-hint">{hint}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="debate__switch-input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

Pills.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      label: PropTypes.string.isRequired,
      icon: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
    })
  ).isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  fill: PropTypes.bool,
  clearable: PropTypes.bool,
};

Row.propTypes = {
  title: PropTypes.string.isRequired,
  hint: PropTypes.string,
  children: PropTypes.node,
  wide: PropTypes.bool,
  stacked: PropTypes.bool,
};

SwitchRow.propTypes = {
  title: PropTypes.string.isRequired,
  hint: PropTypes.string,
  checked: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};
