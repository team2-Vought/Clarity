import { useEffect } from 'react';

const ITEMS = '[role="menuitemradio"], [role="menuitemcheckbox"], [role="menuitem"]';

// пункти згорнутого підменю (inert) фокус не приймають — стрілки їх оминають
const reachable = (menu) =>
  [...(menu?.querySelectorAll(ITEMS) || [])].filter((el) => !el.parentElement.closest('[inert]'));

/**
 * Спільна поведінка меню з пунктами menuitemradio, menuitemcheckbox чи menuitem
 * (формат відповіді, роль, риси характеру): при відкритті фокус на вибраний пункт, клік поза rootRef і menuRef закриває,
 * стрілки ходять пунктами, Esc закриває й повертає фокус на кнопку.
 * tabReturnsFocus — для меню, винесеного порталом: Tab теж повертає на кнопку,
 * а не стрибає в кінець сторінки.
 */
export function usePickerMenu({ isOpen, setIsOpen, rootRef, menuRef, triggerRef, tabReturnsFocus = false }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    // фокус на вибраний пункт, щоб стрілками й Enter можна було обрати одразу;
    // у меню з режимами «вибраний» — це режим, а не увімкнений перемикач поруч
    const menu = menuRef.current;
    const items = reachable(menu);
    const checked = (el) => el.getAttribute('aria-checked') === 'true';
    const hasRadios = Boolean(menu?.querySelector('[role="menuitemradio"]'));
    const target = hasRadios
      ? items.find((el) => checked(el) && el.getAttribute('role') === 'menuitemradio')
      : items.find(checked);
    (target || items[0])?.focus({ preventScroll: true });
    const handleMouseDown = (e) => {
      if (!rootRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, setIsOpen, rootRef, menuRef]);

  const close = (returnFocus = false) => {
    setIsOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    const items = reachable(e.currentTarget);
    const index = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      if (tabReturnsFocus) e.preventDefault();
      close(tabReturnsFocus);
    }
  };

  return { close, handleKeyDown };
}
