import { useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BubbleChatIcon,
  CheckmarkCircle02Icon,
  LeftToRightListBulletIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { copy } from '../copy';
import { usePickerMenu } from '../hooks/usePickerMenu';

const t = copy.debate;

const MODES = [
  { value: 'yes_no', label: t.modeYesNo, icon: CheckmarkCircle02Icon },
  { value: 'choose_one', label: t.modeChooseOne, icon: LeftToRightListBulletIcon },
  { value: 'open', label: t.modeOpen, icon: BubbleChatIcon },
];

// Формат відповіді — меню з кнопки ліворуч у полі питання.
// locked: меню відкривається, але пункти сірі й не обираються (дискусія вже йде).
export default function ModePicker({ value, onChange, disabled = false, locked = false, onChosen }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const current = MODES.find((item) => item.value === value) || MODES[0];

  const { handleKeyDown } = usePickerMenu({
    isOpen,
    setIsOpen,
    rootRef: ref,
    menuRef,
    triggerRef,
  });

  const choose = (next) => {
    if (locked) return;
    onChange?.(next);
    setIsOpen(false);
    onChosen?.();
  };

  return (
    <div className={`debate__mode-picker ${locked ? 'debate__mode-picker--locked' : ''}`} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className={`debate__mode-button ${isOpen ? 'debate__mode-button--open' : ''}`}
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t.modeButton(current.label)}
        title={current.label}
        disabled={disabled}
      >
        <HugeiconsIcon icon={current.icon} size={19} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <div
        ref={menuRef}
        className={`debate__mode-menu ${isOpen ? 'debate__mode-menu--open' : ''}`}
        role="menu"
        aria-label={t.mode}
        inert={!isOpen}
        onKeyDown={handleKeyDown}
      >
        <p className="debate__mode-menu-title" aria-hidden="true">{t.mode}</p>
        {MODES.map((item) => {
          const active = value === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              aria-disabled={locked || undefined}
              className={`debate__mode-item ${active ? 'debate__mode-item--active' : ''}`}
              onClick={() => choose(item.value)}
            >
              <span className="debate__mode-item-icon" aria-hidden="true">
                <HugeiconsIcon icon={item.icon} size={17} strokeWidth={1.8} />
              </span>
              <span className="debate__mode-item-text">
                <span>{item.label}</span>
                <small>{t.modeHints[item.value]}</small>
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
    </div>
  );
}
