import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { ChevronIcon } from './DebateIcons';
import { copy } from '../copy';
import { useFloatingMenu } from '../hooks/useFloatingMenu';
import { usePickerMenu } from '../hooks/usePickerMenu';
import { roleIcon } from '../utils/debateOptions';

const t = copy.debate;

// меню трохи ширше за кнопку — на ширину поля анкети
const OUTSET = 10;

// Роль учасника — кнопка з поточною роллю і меню в стилі «Формату відповіді».
// Роль, яку вже має інший учасник, видно в меню з його номером, але обрати її не можна.
// Меню винесене шаром поверх сторінки: у панелі його обрізала б прокрутка й накривав футер.
export default function RolePicker({ personas, participants, value, onChange, disabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const current = personas.find((persona) => persona.slug === value);

  const { host, place } = useFloatingMenu(isOpen, ref, menuRef, { outset: OUTSET });

  const { close, handleKeyDown } = usePickerMenu({
    isOpen,
    setIsOpen,
    rootRef: ref,
    menuRef,
    triggerRef,
    tabReturnsFocus: true,
  });

  const choose = (slug, taken) => {
    if (taken) return;
    onChange(slug);
    close(true);
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
        ref={triggerRef}
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
