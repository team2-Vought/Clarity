import { useEffect } from 'react';

/**
 * Спільна поведінка меню з пунктами menuitemradio (формат відповіді, роль):
 * при відкритті фокус на вибраний пункт, клік поза rootRef і menuRef закриває,
 * стрілки ходять пунктами, Esc закриває й повертає фокус на кнопку.
 * tabReturnsFocus — для меню, винесеного порталом: Tab теж повертає на кнопку,
 * а не стрибає в кінець сторінки.
 */
export function usePickerMenu({ isOpen, setIsOpen, rootRef, menuRef, triggerRef, tabReturnsFocus = false }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    // фокус на вибраний пункт, щоб стрілками й Enter можна було обрати одразу
    menuRef.current?.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
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
    const items = [...e.currentTarget.querySelectorAll('[role="menuitemradio"]')];
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
