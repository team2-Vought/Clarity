import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { SmileIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import { ChevronIcon } from './DebateIcons';
import { copy } from '../copy';
import { useFloatingMenu } from '../hooks/useFloatingMenu';
import { usePickerMenu } from '../hooks/usePickerMenu';

const t = copy.debate;

// меню трохи ширше за кнопку — на ширину поля анкети, як у RolePicker
const OUTSET = 10;

// Риси характеру — кнопка з обраними рисами і меню з галочками.
// Рис можна обрати кілька, тож меню не закривається після кліку;
// унизу меню — поле для своєї риси.
export default function TraitPicker({
  traits,
  value,
  onToggle,
  draft,
  onDraftChange,
  onAdd,
  maxLength,
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const countRef = useRef(traits.length);

  const { host, place } = useFloatingMenu(isOpen, ref, menuRef, { outset: OUTSET });

  const { handleKeyDown } = usePickerMenu({
    isOpen,
    setIsOpen,
    rootRef: ref,
    menuRef,
    triggerRef,
    tabReturnsFocus: true,
  });

  // щойно додана своя риса — в кінці списку, тож прокручуємо до неї
  useEffect(() => {
    if (traits.length > countRef.current && isOpen) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
    countRef.current = traits.length;
  }, [traits.length, isOpen]);

  // у полі стрілки рухають курсор, а Enter додає рису; Esc і Tab закривають меню
  const handleDraftKeyDown = (e) => {
    if (e.key === 'Escape' || e.key === 'Tab') return;
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    e.preventDefault(); // Enter у полі не має відправляти форму
    onAdd();
  };

  const menu = (
    <div
      ref={menuRef}
      className={`debate__mode-menu debate__role-menu debate__trait-menu ${isOpen ? 'debate__mode-menu--open' : ''} ${place?.up ? 'debate__role-menu--up' : ''}`}
      style={place ? { top: place.top, left: place.left, width: place.width } : undefined}
      role="menu"
      aria-label={t.character}
      inert={!isOpen}
      onKeyDown={handleKeyDown}
    >
      {/* список прокручується сам, а поле своєї риси лишається внизу меню */}
      <div className="debate__trait-list" ref={listRef}>
        {traits.map((trait) => {
          const active = value.includes(trait);
          return (
            <button
              key={trait}
              type="button"
              role="menuitemcheckbox"
              aria-checked={active}
              className={`debate__mode-item debate__trait-item ${active ? 'debate__mode-item--active' : ''}`}
              onClick={() => onToggle(trait)}
            >
              <span className="debate__mode-item-text">
                <span>{trait}</span>
              </span>
              {active && (
                <HugeiconsIcon
                  icon={Tick02Icon}
                  size={16}
                  className="debate__mode-item-check"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
      <span className="debate__tag-new debate__trait-new">
        <input
          type="text"
          value={draft}
          maxLength={maxLength}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleDraftKeyDown}
          placeholder={t.placeholderTrait}
          aria-label={t.customTrait}
        />
        {draft.trim() && (
          <button
            type="button"
            className="debate__mini-add"
            onClick={onAdd}
            aria-label={t.addTrait}
            title={t.addTrait}
          >
            +
          </button>
        )}
      </span>
    </div>
  );

  return (
    <div className="debate__role-picker" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className={`debate__role-button debate__trait-button ${isOpen ? 'debate__role-button--open' : ''}`}
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t.traitsButton(value)}
        disabled={disabled}
      >
        <span className="debate__role-button-icon debate__role-button-icon--neutral" aria-hidden="true">
          <HugeiconsIcon icon={SmileIcon} size={17} strokeWidth={1.8} />
        </span>
        {value.length > 0 ? (
          <span className="debate__tags debate__trait-chips">
            {value.map((trait) => (
              <span key={trait} className="debate__tag debate__tag--active">{trait}</span>
            ))}
          </span>
        ) : (
          <span className="debate__trait-placeholder">{t.chooseTraits}</span>
        )}
        <span className="debate__model-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {host && createPortal(menu, host)}
    </div>
  );
}
