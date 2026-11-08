import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  Download04Icon,
  FileExportIcon,
  Loading03Icon,
  Pdf01Icon,
} from '@hugeicons/core-free-icons';
import { useFloatingMenu } from '../../hooks/useFloatingMenu';
import { usePickerMenu } from '../../hooks/usePickerMenu';
import { copy } from '../../copy';

const t = copy.chat;
const EDGE = 8;

/**
 * «Зберегти» у рядку дій висновку: одна кнопка замість двох форматів.
 * PDF — рішення й аргументи для друку чи пересилання, Markdown — уся дискусія текстом.
 */
export default function SaveMenu({ onPdf, onMarkdown, busy = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const { host, place } = useFloatingMenu(isOpen, triggerRef, menuRef);
  const { close, handleKeyDown } = usePickerMenu({
    isOpen,
    setIsOpen,
    rootRef,
    menuRef,
    triggerRef,
    tabReturnsFocus: true,
  });
  const [left, setLeft] = useState(null);

  // меню ширше за кнопку — не даємо йому вилізти за правий край екрана
  useLayoutEffect(() => {
    if (!isOpen || !place || !menuRef.current) return;
    const width = menuRef.current.offsetWidth;
    setLeft(Math.max(EDGE, Math.min(place.left, window.innerWidth - EDGE - width)));
  }, [isOpen, place]);

  const choose = (action) => {
    close(true);
    action?.();
  };

  const items = [
    { key: 'pdf', icon: Pdf01Icon, label: t.save.pdf, hint: t.save.pdfHint, run: onPdf },
    { key: 'markdown', icon: FileExportIcon, label: t.save.markdown, hint: t.save.markdownHint, run: onMarkdown },
  ].filter((item) => item.run);

  return (
    <span className="chat__save" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`chat__action ${isOpen ? 'chat__action--active' : ''}`}
        onClick={() => setIsOpen((open) => !open)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        title={busy ? t.pdfPreparing : t.save.hint}
      >
        <HugeiconsIcon
          icon={busy ? Loading03Icon : Download04Icon}
          size={16}
          className={busy ? 'chat__icon-spin' : undefined}
          aria-hidden="true"
        />
        <span>{busy ? t.pdfPreparing : t.save.label}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="chat__save-chevron" aria-hidden="true" />
      </button>

      {/* меню в розмітці й закрите — як інші випадні меню, і відкриття, і закриття плавні */}
      {host && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className={[
            'debate__mode-menu debate__role-menu chat__save-menu',
            isOpen && 'debate__mode-menu--open',
            place?.up && 'debate__role-menu--up',
          ].filter(Boolean).join(' ')}
          role="menu"
          aria-label={t.save.label}
          inert={!isOpen}
          onKeyDown={handleKeyDown}
          style={place ? { top: place.top, left: left ?? place.left } : undefined}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="debate__mode-item"
              onClick={() => choose(item.run)}
            >
              <span className="debate__mode-item-icon" aria-hidden="true">
                <HugeiconsIcon icon={item.icon} size={17} strokeWidth={1.8} />
              </span>
              <span className="debate__mode-item-text">
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </span>
            </button>
          ))}
        </div>,
        host
      )}
    </span>
  );
}

SaveMenu.propTypes = {
  onPdf: PropTypes.func,
  onMarkdown: PropTypes.func,
  busy: PropTypes.bool,
};
