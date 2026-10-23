import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { ChevronIcon } from './DebateIcons';
import { uk } from '../copy/uk';
import { useFloatingMenu } from '../hooks/useFloatingMenu';
import { roleIcon } from '../utils/debateOptions';

const t = uk.debate;

// меню трохи ширше за кнопку — на ширину поля анкети
const OUTSET = 10;

// Роль учасника — кнопка з поточною роллю і меню в стилі «Формату відповіді».
// Роль, яку вже має інший учасник, видно в меню з його номером, але обрати її не можна.
// Меню винесене шаром поверх сторінки: у панелі його обрізала б прокрутка й накривав футер.
export default function RolePicker({ personas, participants, value, onChange, disabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const current = personas.find((persona) => persona.slug === value);

  const { host, place } = useFloatingMenu(isOpen, ref, menuRef, { outset: OUTSET });

  useEffect(() => {
    if (!isOpen) return undefined;
    // фокус на вибраний пункт, щоб стрілками й Enter можна було обрати одразу
    menuRef.current?.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
    const handleMouseDown = (e) => {
      if (!ref.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  const close = (returnFocus = false) => {
    setIsOpen(false);
    if (returnFocus) ref.current?.querySelector('.debate__role-button')?.focus();
  };

  const choose = (slug, taken) => {
    if (taken) return;
    onChange(slug);
    close(true);
  };

  const handleKeyDown = (e) => {
    const items = [...e.currentTarget.querySelectorAll('[role="menuitemradio"]')];
    const index = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      // меню живе в іншому місці розмітки — Tab повертає на кнопку, а не стрибає в кінець сторінки
      e.preventDefault();
      close(true);
    }
  };

  const menu = (
    <div
      ref={menuRef}
      className={`debate__mode-menu debate__role-menu ${isOpen ? 'debate__mode-menu--open' : ''} ${place?.up ? 'debate__role-menu--up' : ''}`}
      style={place ? { top: place.top, left: place.left, width: place.width } : undefined}
      role="menu"
      aria-label={t.role}
      inert={!isOpen}
      onKeyDown={handleKeyDown}
    >
      {personas.map((persona) => {
        const active = persona.slug === value;
        const holderIndex = participants.findIndex((p) => p.slug === persona.slug);
        const holder = !active && holderIndex >= 0 ? participants[holderIndex] : null;
        const holderLabel = holder ? holder.name.trim() || t.participantN(holderIndex + 1) : '';
        return (
          <button
            key={persona.slug}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            aria-disabled={holder ? true : undefined}
            className={`debate__mode-item ${active ? 'debate__mode-item--active' : ''} ${holder ? 'debate__role-item--taken' : ''}`}
            title={holder ? t.roleHeldBy(holderLabel) : undefined}
            onClick={() => choose(persona.slug, Boolean(holder))}
          >
            <span className="debate__mode-item-icon" aria-hidden="true">
              <HugeiconsIcon icon={roleIcon(persona.slug)} size={17} strokeWidth={1.8} />
            </span>
            <span className="debate__mode-item-text">
              <span>{persona.name}</span>
              {persona.description && <small>{persona.description}</small>}
            </span>
            {active && (
              <HugeiconsIcon
                icon={Tick02Icon}
                size={16}
                className="debate__mode-item-check"
                aria-hidden="true"
              />
            )}
            {holder && (
              <span className="debate__role-holder" style={{ '--chip': holder.color }} aria-hidden="true">
                {holderIndex + 1}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="debate__role-picker" ref={ref}>
      <button
        type="button"
        className={`debate__role-button ${isOpen ? 'debate__role-button--open' : ''}`}
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t.roleButton(current?.name || '')}
        disabled={disabled}
      >
        <span className="debate__role-button-icon" aria-hidden="true">
          <HugeiconsIcon icon={roleIcon(value)} size={17} strokeWidth={1.8} />
        </span>
        <span className="debate__role-button-text">
          <span>{current?.name}</span>
          {current?.description && <small>{current.description}</small>}
        </span>
        <span className="debate__model-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {host && createPortal(menu, host)}
    </div>
  );
}
