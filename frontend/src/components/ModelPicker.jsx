import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { AiModelIcon, ChevronIcon } from './DebateIcons';
import ProviderLogo from './ProviderLogo';
import { copy } from '../copy';
import { useFloatingMenu } from '../hooks/useFloatingMenu';

const t = copy.debate;

// галочка біля вибраної моделі — як у меню ролі й формату відповіді
const OptionCheck = () => (
  <HugeiconsIcon icon={Tick02Icon} size={16} className="debate__model-option-check" aria-hidden="true" />
);

// логотип провайдера моделі; для «автоматично» й провайдерів без логотипа — загальна іскра
const ModelIcon = ({ model }) => <ProviderLogo provider={model?.provider_id} fallback={<AiModelIcon />} />;

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
  // у кнопці провайдера вже видно з логотипа — лишаємо назву моделі, щоб вона не обрізалася;
  // повна назва «Провайдер — модель» — у підказці й у списку
  const text = selected ? selected.label || selected.model : value ? value : autoLabel;

  useEffect(() => {
    if (!isOpen) return undefined;
    // список довгий: вибрана модель — посередині видимої частини, а не обрізана внизу
    const list = menuRef.current;
    const option = list?.querySelector('[aria-selected="true"]');
    if (list && option) {
      list.scrollTop = option.offsetTop - (list.clientHeight - option.offsetHeight) / 2;
    }
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
        title={selected ? modelLabel(selected) : undefined}
      >
        <ModelIcon model={selected} />
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
                <span className="debate__model-option-icon">
                  <AiModelIcon />
                </span>
                <span className="debate__model-option-label">{autoLabel}</span>
                {!value && <OptionCheck />}
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
                  <span className="debate__model-option-icon">
                    <ModelIcon model={model} />
                  </span>
                  {/* позначка — під назвою: поруч у вузькій панелі вона стискала назву до однієї літери в рядку */}
                  <span className="debate__model-option-label">
                    {modelLabel(model)}
                    {!model.available && (
                      <span className="debate__model-option-note">{t.modelUnavailable}</span>
                    )}
                  </span>
                  {active && <OptionCheck />}
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
