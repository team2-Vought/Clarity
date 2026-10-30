import { useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowRight01Icon,
  Attachment01Icon,
  BubbleChatIcon,
  CheckmarkCircle02Icon,
  IdentityCardIcon,
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
// extras: пункти під форматом — файл, швидка відповідь, «Про мене», пошук.
// Пункт з checked — перемикач (меню лишається відкритим), без checked — дія (меню закривається).
// З extras меню компактне, як у Claude: формат — один рядок, а три режими
// виїжджають з нього вбік при наведенні (на телефоні — розгортаються під ним).
export default function ModePicker({
  value,
  onChange,
  disabled = false,
  locked = false,
  onChosen,
  extras,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubOpen, setIsSubOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const formatRef = useRef(null);
  const subRef = useRef(null);
  const current = MODES.find((item) => item.value === value) || MODES[0];
  const hasExtras = Boolean(extras?.length);

  const { close, handleKeyDown } = usePickerMenu({
    isOpen,
    setIsOpen,
    rootRef: ref,
    menuRef,
    triggerRef,
  });

  // підменю живе лише у відкритому меню; кнопка щоразу відкриває його згорнутим
  const subOpen = isOpen && isSubOpen;

  const choose = (next) => {
    if (locked) return;
    onChange?.(next);
    setIsOpen(false);
    onChosen?.();
  };

  const pickExtra = (item) => {
    if (item.disabled) return;
    if (item.checked === undefined) close(true);
    item.onSelect();
  };

  const openSub = (focus) => {
    setIsSubOpen(true);
    // inert знімається з рендером — фокус переносимо вже після нього
    if (focus) requestAnimationFrame(() => subRef.current?.querySelector('[aria-checked="true"]')?.focus());
  };

  const handleSubKeyDown = (e) => {
    if (e.key !== 'ArrowLeft') return;
    e.preventDefault();
    e.stopPropagation();
    setIsSubOpen(false);
    formatRef.current?.focus();
  };

  const modeItems = MODES.map((item) => {
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
  });

  return (
    <div className={`debate__mode-picker ${locked ? 'debate__mode-picker--locked' : ''}`} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className={[
          'debate__mode-button',
          hasExtras && 'debate__mode-button--trio',
          isOpen && 'debate__mode-button--open',
        ].filter(Boolean).join(' ')}
        onClick={() => {
          setIsSubOpen(false);
          setIsOpen((open) => !open);
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={hasExtras ? t.optionsButton(current.label) : t.modeButton(current.label)}
        title={current.label}
        disabled={disabled}
      >
        {/* у полі нової дискусії тут же файли й «Про мене» — три іконки купкою в одному колі */}
        {hasExtras ? (
          <span className="debate__mode-trio" aria-hidden="true">
            <HugeiconsIcon icon={current.icon} size={18} strokeWidth={1.8} />
            <HugeiconsIcon icon={Attachment01Icon} size={15} strokeWidth={1.8} />
            <HugeiconsIcon icon={IdentityCardIcon} size={15} strokeWidth={1.8} />
          </span>
        ) : (
          <HugeiconsIcon icon={current.icon} size={19} strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
      <div
        ref={menuRef}
        className={[
          'debate__mode-menu',
          hasExtras && 'debate__mode-menu--compact',
          isOpen && 'debate__mode-menu--open',
        ].filter(Boolean).join(' ')}
        role="menu"
        aria-label={t.mode}
        inert={!isOpen}
        onKeyDown={handleKeyDown}
      >
        {!hasExtras && (
          <>
            <p className="debate__mode-menu-title" aria-hidden="true">{t.mode}</p>
            {modeItems}
          </>
        )}
        {hasExtras && (
          <>
            <div
              className={`debate__mode-format ${subOpen ? 'debate__mode-format--open' : ''}`}
              onPointerEnter={(e) => e.pointerType === 'mouse' && openSub(false)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setIsSubOpen(false)}
            >
              <button
                ref={formatRef}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={subOpen}
                className="debate__mode-item debate__mode-item--row"
                onClick={() => (subOpen ? setIsSubOpen(false) : openSub(false))}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  openSub(true);
                }}
              >
                <span className="debate__mode-item-icon" aria-hidden="true">
                  <HugeiconsIcon icon={current.icon} size={16} strokeWidth={1.8} />
                </span>
                <span className="debate__mode-item-text">
                  <span>{t.mode}</span>
                  <small>{current.label}</small>
                </span>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={16}
                  className="debate__mode-item-chevron"
                  aria-hidden="true"
                />
              </button>
              <div
                ref={subRef}
                className="debate__mode-sub"
                role="menu"
                aria-label={t.mode}
                inert={!subOpen}
                onKeyDown={handleSubKeyDown}
              >
                <div className="debate__mode-sub-inner">{modeItems}</div>
              </div>
            </div>
            <div className="debate__mode-menu-divider" role="separator" />
            {extras.map((item) => {
              const isToggle = item.checked !== undefined;
              return (
                <button
                  key={item.key}
                  type="button"
                  role={isToggle ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={isToggle ? item.checked : undefined}
                  aria-disabled={item.disabled || undefined}
                  className={[
                    'debate__mode-item',
                    'debate__mode-item--row',
                    item.disabled && 'debate__mode-item--disabled',
                  ].filter(Boolean).join(' ')}
                  title={item.hint}
                  onClick={() => pickExtra(item)}
                >
                  <span className="debate__mode-item-icon" aria-hidden="true">
                    <HugeiconsIcon icon={item.icon} size={16} strokeWidth={1.8} />
                  </span>
                  <span className="debate__mode-item-text">
                    <span>{item.label}</span>
                  </span>
                  {isToggle && (
                    <span
                      className={`debate__mode-switch ${item.checked ? 'debate__mode-switch--on' : ''}`}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
