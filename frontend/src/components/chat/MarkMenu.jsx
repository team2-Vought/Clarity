import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert02Icon,
  Bookmark02Icon,
  BubbleChatQuestionIcon,
  Cancel01Icon,
} from '@hugeicons/core-free-icons';
import { useFloatingMenu } from '../../hooks/useFloatingMenu';
import { usePickerMenu } from '../../hooks/usePickerMenu';
import { copy } from '../../copy';
import { HIGHLIGHT_COLORS } from '../../utils/highlights';

const t = copy.marks;
const EDGE = 8;

/**
 * Одне меню біля репліки AI: позначити всю репліку тими самими значеннями,
 * що й виділений фрагмент («Важливо», «Згоден», «Сумнів»), попросити пояснити
 * простіше чи повідомити про помилку у фактах.
 */
export default function MarkMenu({ mark = '', onChange, onExplain, onReport, busy = false }) {
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

  const choose = (next) => {
    close(true);
    if (next !== mark) onChange(next);
  };

  const run = (action) => {
    close(false);
    action();
  };

  const label = mark ? t.colors[mark] : '';

  return (
    <span className="chat__mark" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={mark ? `chat__mark-chip chat__mark-chip--${mark}` : 'chat__icon-button chat__mark-trigger'}
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={mark ? t.markChange(label) : t.markAria}
        title={mark ? t.markHints[mark] : t.markAria}
        disabled={busy}
      >
        {mark ? (
          <span className={`marks__dot marks__dot--${mark}`} aria-hidden="true" />
        ) : (
          <HugeiconsIcon icon={Bookmark02Icon} size={16} aria-hidden="true" />
        )}
        {mark && <span>{label}</span>}
      </button>

      {isOpen && host && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className={`chat__menu ${place?.up ? 'chat__menu--up' : ''}`}
          role="menu"
          aria-label={t.markMenu}
          onKeyDown={handleKeyDown}
          style={place ? { top: place.top, left: left ?? place.left } : { visibility: 'hidden' }}
        >
          <span className="chat__menu-caption" aria-hidden="true">{t.markWhole}</span>
          {HIGHLIGHT_COLORS.map((key) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={mark === key}
              className="chat__menu-option"
              onClick={() => choose(key)}
            >
              <span className={`chat__menu-icon chat__menu-icon--${key}`} aria-hidden="true">
                <span className={`marks__dot marks__dot--${key}`} />
              </span>
              <span className="chat__menu-text">
                <span className="chat__menu-label">{t.colors[key]}</span>
                <span className="chat__menu-hint">{t.markHints[key]}</span>
              </span>
            </button>
          ))}
          {mark && (
            <button type="button" role="menuitem" className="chat__menu-option" onClick={() => choose('')}>
              <span className="chat__menu-icon" aria-hidden="true">
                <HugeiconsIcon icon={Cancel01Icon} size={16} />
              </span>
              <span className="chat__menu-label">{t.removeMark}</span>
            </button>
          )}
          {(onExplain || onReport) && <span className="chat__menu-divider" role="separator" />}
          {onExplain && (
            <button type="button" role="menuitem" className="chat__menu-option" onClick={() => run(onExplain)}>
              <span className="chat__menu-icon" aria-hidden="true">
                <HugeiconsIcon icon={BubbleChatQuestionIcon} size={16} />
              </span>
              <span className="chat__menu-text">
                <span className="chat__menu-label">{t.askExplain}</span>
                <span className="chat__menu-hint">{t.askExplainHint}</span>
              </span>
            </button>
          )}
          {onReport && (
            <button type="button" role="menuitem" className="chat__menu-option" onClick={() => run(onReport)}>
              <span className="chat__menu-icon" aria-hidden="true">
                <HugeiconsIcon icon={Alert02Icon} size={16} />
              </span>
              <span className="chat__menu-text">
                <span className="chat__menu-label">{t.reportWrong}</span>
                <span className="chat__menu-hint">{t.reportWrongHint}</span>
              </span>
            </button>
          )}
        </div>,
        host
      )}
    </span>
  );
}

MarkMenu.propTypes = {
  mark: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onExplain: PropTypes.func,
  onReport: PropTypes.func,
  busy: PropTypes.bool,
};
