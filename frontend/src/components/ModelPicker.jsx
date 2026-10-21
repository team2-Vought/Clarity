import { useEffect, useRef, useState } from 'react';
import { AiModelIcon, ChevronIcon } from './DebateIcons';
import { uk } from '../copy/uk';

const t = uk.debate;

const modelLabel = (model) =>
  model ? `${model.provider} — ${model.label || model.model}` : '';

/**
 * Випадний список моделей з каталогу. `autoLabel` додає пункт «автоматично»
 * (порожнє значення) — для модератора й AI Devil.
 */
export default function ModelPicker({
  models,
  value,
  onChange,
  disabled = false,
  label = t.aiModel,
  autoLabel = '',
  compact = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);
  const selected = models.find((model) => model.id === value);
  const text = selected ? modelLabel(selected) : value ? value : autoLabel;

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleMouseDown = (e) => {
      if (!ref.current?.contains(e.target)) setIsOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const choose = (modelId) => {
    onChange(modelId);
    setIsOpen(false);
  };

  return (
    <div className={`debate__model-card ${compact ? 'debate__model-card--compact' : ''}`} ref={ref}>
      <button
        type="button"
        className={`debate__model-toggle ${isOpen ? 'debate__model-toggle--open' : ''}`}
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={label}
      >
        <AiModelIcon />
        <span className="debate__model-row">
          <span className={`debate__model-value ${text ? '' : 'debate__model-value--placeholder'}`}>
            {text || t.chooseModel}
          </span>
          {!disabled && (
            <span className="debate__model-chevron">
              <ChevronIcon />
            </span>
          )}
        </span>
      </button>
      {isOpen && (
        <ul className="debate__model-menu" role="listbox" aria-label={label}>
          {autoLabel && (
            <li role="presentation">
              <button
                type="button"
                className={`debate__model-option ${!value ? 'debate__model-option--active' : ''}`}
                role="option"
                aria-selected={!value}
                onClick={() => choose('')}
              >
                <span>{autoLabel}</span>
              </button>
            </li>
          )}
          {models.map((model) => {
            const active = value === model.id;
            return (
              <li key={model.id} role="presentation">
                <button
                  type="button"
                  className={`debate__model-option ${active ? 'debate__model-option--active' : ''}`}
                  role="option"
                  aria-selected={active}
                  disabled={!model.available}
                  title={model.available ? model.notes : `${t.modelUnavailable}: ${model.key_env}`}
                  onClick={() => choose(model.id)}
                >
                  <span>{modelLabel(model)}</span>
                  {!model.available && (
                    <span className="debate__model-option-note">{t.modelUnavailable}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
