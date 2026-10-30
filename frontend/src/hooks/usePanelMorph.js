import { useLayoutEffect, useRef } from 'react';
import { morphSheet } from '../utils/sidebarMorph';

const PHONE = '(max-width: 639px)';

/**
 * На телефоні права панель налаштувань виростає зі своєї кнопки, а її блоки
 * вилітають хвилею (див. morphSheet). Рух запускається до першого кадру, тож
 * блоки одразу стартують біля кнопки. На ширших екранах панель не висувна.
 */
export function usePanelMorph(open, panelRef) {
  const store = useRef([]);
  const previous = useRef(open);
  useLayoutEffect(() => {
    if (previous.current === open) return;
    previous.current = open;
    if (!window.matchMedia?.(PHONE).matches) return;
    const panel = panelRef.current;
    morphSheet(panel, panel?.closest('.debate-page')?.querySelector('.debate__panel-toggle'), open, store);
  }, [open, panelRef]);
}
