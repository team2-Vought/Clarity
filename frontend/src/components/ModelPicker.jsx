import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AiModelIcon, ChevronIcon } from './DebateIcons';
import { uk } from '../copy/uk';
import { useFloatingMenu } from '../hooks/useFloatingMenu';

const t = uk.debate;

const modelLabel = (model) =>
  model ? `${model.provider} — ${model.label || model.model}` : '';

/**
 * Випадний список моделей з каталогу. `autoLabel` додає пункт «автоматично»
 * (порожнє значення) — для модератора й AI Devil.
 * Список — шар поверх сторінки, щоб його не обрізала прокрутка панелі й не накривав футер.
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
  const menuRef = useRef(null);
  const { host, place } = useFloatingMenu(isOpen, ref, menuRef, { gap: 4 });
  const selected = models.find((model) => model.id === value);
  const text = selected ? modelLabel(selected) : value ? value : autoLabel;

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleMouseDown = (e) => {
      if (!ref.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setIsOpen(false);
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

  // список живе в іншому місці розмітки: Tab з кнопки веде в нього, а з краю списку — назад на кнопку
  const handleToggleKeyDown = (e) => {
    if (!isOpen || e.key !== 'Tab' || e.shiftKey) return;
    const options = [...(menuRef.current?.querySelectorAll('.debate__model-option:not(:disabled)') || [])];
    const target = options.find((option) => option.getAttribute('aria-selected') === 'true') || options[0];
    if (!target) return;
    e.preventDefault();
    target.focus({ preventScroll: true });
  };

  const handleMenuKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const options = [...e.currentTarget.querySelectorAll('.debate__model-option:not(:disabled)')];
    const edge = e.shiftKey ? options[0] : options[options.length - 1];
    if (document.activeElement !== edge) return;
    e.preventDefault();
    setIsOpen(false);
    ref.current?.querySelector('.debate__model-toggle')?.focus();
  };

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
        onKeyDown={handleToggleKeyDown}
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
      {host && createPortal(
        <ul
          ref={menuRef}
          className={`debate__model-menu ${isOpen ? 'debate__model-menu--open' : ''} ${place?.up ? 'debate__model-menu--up' : ''}`}
          style={place ? { top: place.top, left: place.left, width: place.width } : undefined}
          role="listbox"
          aria-label={label}
          inert={!isOpen}
          aria-hidden={!isOpen}
          onKeyDown={handleMenuKeyDown}
        >
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
        </ul>,
        host
      )}
    </div>
  );
}
