import { useEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BubbleChatIcon,
  CheckmarkCircle02Icon,
  LeftToRightListBulletIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { uk } from '../copy/uk';

const t = uk.debate;

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
  const current = MODES.find((item) => item.value === value) || MODES[0];

  useEffect(() => {
    if (!isOpen) return undefined;
    // фокус на вибраний пункт, щоб стрілками й Enter можна було обрати одразу
    ref.current?.querySelector('[aria-checked="true"]')?.focus();
    const handleMouseDown = (e) => {
      if (!ref.current?.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  const close = (returnFocus = false) => {
    setIsOpen(false);
    if (returnFocus) ref.current?.querySelector('.debate__mode-button')?.focus();
  };

  const choose = (next) => {
    if (locked) return;
    onChange?.(next);
    setIsOpen(false);
    onChosen?.();
  };

  const handleKeyDown = (e) => {
    const items = [...e.currentTarget.querySelectorAll('[role="menuitemradio"]')];
    const index = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      close(e.key === 'Escape');
    }
  };

  return (
    <div className={`debate__mode-picker ${locked ? 'debate__mode-picker--locked' : ''}`} ref={ref}>
      <button
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
