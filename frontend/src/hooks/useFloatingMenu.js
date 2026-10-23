import { useEffect, useLayoutEffect, useState } from 'react';

const EDGE = 8;

/**
 * Випадне меню шаром поверх сторінки: позиція від якоря, а не від батька,
 * тож меню не обрізає прокрутка панелі й не накриває футер.
 * Повертає host — куди рендерити меню порталом (усередині .app-shell, щоб
 * діяли змінні теми), і place — { top, left, width, up } для position: fixed.
 * outset — на скільки меню ширше за якір з кожного боку.
 */
export function useFloatingMenu(isOpen, anchorRef, menuRef, { gap = 6, outset = 0 } = {}) {
  const [host, setHost] = useState(null);
  const [place, setPlace] = useState(null);

  useEffect(() => {
    setHost(anchorRef.current?.closest('.app-shell') || document.body);
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const menuHeight = menuRef.current?.offsetHeight || 0;
      const below = anchor.bottom + gap;
      // знизу не влазить — відкриваємо вгору, а якщо й там тісно, притискаємо до краю екрана
      const up = below + menuHeight > window.innerHeight - EDGE && anchor.top - gap - menuHeight >= EDGE;
      const top = up
        ? anchor.top - gap - menuHeight
        : Math.max(EDGE, Math.min(below, window.innerHeight - EDGE - menuHeight));
      const width = Math.min(anchor.width + outset * 2, window.innerWidth - EDGE * 2);
      const left = Math.max(EDGE, Math.min(anchor.left - outset, window.innerWidth - EDGE - width));
      setPlace({ top, left, width, up });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isOpen, anchorRef, menuRef, gap, outset]);

  return { host, place };
}
