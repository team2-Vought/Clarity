import { useState } from 'react';
import PropTypes from 'prop-types';
import { copy } from '../copy';

const t = copy.debate;
const MAX_CRITERIA = 6;
const NAME_MAX = 60;
const WEIGHTS = [1, 2, 3, 4, 5];

/**
 * Критерії вибору з вагою 1–5 — для «Один із варіантів». Учасники оцінять
 * кожен варіант за кожним критерієм, а висновок покаже матрицю.
 */
export default function CriteriaEditor({ value, onChange, disabled = false, onLimit }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const name = draft.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (!name) return;
    if (value.length >= MAX_CRITERIA) {
      onLimit?.(t.criteriaMax);
      return;
    }
    if (!value.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      onChange([...value, { name, weight: 3 }]);
    }
    setDraft('');
  };

  const setWeight = (name, weight) =>
    onChange(value.map((item) => (item.name === name ? { ...item, weight } : item)));

  return (
    <div className="criteria">
      <div className="criteria__head">
        <span className="criteria__title">{t.criteria}</span>
        <span className="criteria__hint">{t.criteriaHint}</span>
      </div>
      {value.length > 0 && (
        <ul className="criteria__list">
          {value.map((item) => (
            <li key={item.name} className="criteria__item">
              <span className="criteria__name">{item.name}</span>
              <span className="criteria__weights" role="radiogroup" aria-label={t.criteriaWeight(item.name, item.weight)}>
                {WEIGHTS.map((weight) => (
                  <button
                    key={weight}
                    type="button"
                    role="radio"
                    aria-checked={item.weight === weight}
                    aria-label={t.criteriaWeight(item.name, weight)}
                    className={`criteria__dot ${weight <= item.weight ? 'criteria__dot--on' : ''}`}
                    onClick={() => setWeight(item.name, weight)}
                    disabled={disabled}
                  />
                ))}
              </span>
              <button
                type="button"
                className="criteria__remove"
                onClick={() => onChange(value.filter((other) => other.name !== item.name))}
                aria-label={t.criteriaRemove(item.name)}
                disabled={disabled}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length < MAX_CRITERIA && (
        <input
          className="criteria__input"
          type="text"
          value={draft}
          maxLength={NAME_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return;
            e.preventDefault();
            add();
          }}
          onBlur={add}
          placeholder={value.length ? t.criteriaPlaceholderMore : t.criteriaPlaceholder}
          aria-label={t.criteria}
          disabled={disabled}
        />
      )}
    </div>
  );
}

CriteriaEditor.propTypes = {
  value: PropTypes.arrayOf(PropTypes.shape({ name: PropTypes.string, weight: PropTypes.number })).isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  onLimit: PropTypes.func,
};
