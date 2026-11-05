import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, SmileIcon } from '@hugeicons/core-free-icons';
import { useFloatingMenu } from '../../hooks/useFloatingMenu';
import { usePickerMenu } from '../../hooks/usePickerMenu';
import { copy } from '../../copy';
import { REACTIONS } from '../../utils/highlights';
import { REACTION_ICONS } from './reactionIcons';

const t = copy.marks;
const EDGE = 8;

/**
 * Реакція на репліку AI: одна на репліку, змінюється й знімається в тому ж меню.
 * Після «Незрозуміло» й «Помилка у фактах» поруч з'являється наступний крок:
 * попросити пояснити чи повідомити нам.
 */
export default function ReactionPicker({ reaction = '', onChange, onExplain, onReport, busy = false }) {
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
    if (next !== reaction) onChange(next);
  };

  const label = reaction ? t.reactions[reaction] : '';

  return (
    <span className="chat__reaction" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={reaction ? `chat__reaction-chip chat__reaction-chip--${reaction}` : 'chat__icon-button chat__react'}
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={reaction ? t.reactionChange(label) : t.reactAria}
        title={reaction ? t.reactionHints[reaction] : t.reactAria}
        disabled={busy}
      >
        <HugeiconsIcon icon={reaction ? REACTION_ICONS[reaction] : SmileIcon} size={reaction ? 14 : 16} aria-hidden="true" />
        {reaction && <span>{label}</span>}
      </button>

      {reaction === 'unclear' && onExplain && (
        <button type="button" className="chat__reaction-next" onClick={onExplain}>
          {t.askExplain}
        </button>
      )}
      {reaction === 'wrong' && onReport && (
        <button type="button" className="chat__reaction-next" onClick={onReport}>
          {t.reportWrong}
        </button>
      )}

      {isOpen && host && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className={`chat__reaction-menu ${place?.up ? 'chat__reaction-menu--up' : ''}`}
          role="menu"
          aria-label={t.reactionsLabel}
          onKeyDown={handleKeyDown}
          style={place ? { top: place.top, left: left ?? place.left } : { visibility: 'hidden' }}
        >
          {REACTIONS.map((key) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={reaction === key}
              className={`chat__reaction-option chat__reaction-option--${key}`}
              onClick={() => choose(key)}
            >
              <span className="chat__reaction-icon" aria-hidden="true">
                <HugeiconsIcon icon={REACTION_ICONS[key]} size={16} />
              </span>
              <span className="chat__reaction-text">
                <span className="chat__reaction-label">{t.reactions[key]}</span>
                <span className="chat__reaction-hint">{t.reactionHints[key]}</span>
              </span>
            </button>
          ))}
          {reaction && (
            <button
              type="button"
              role="menuitem"
              className="chat__reaction-option chat__reaction-option--remove"
              onClick={() => choose('')}
            >
              <span className="chat__reaction-icon" aria-hidden="true">
                <HugeiconsIcon icon={Cancel01Icon} size={16} />
              </span>
              <span className="chat__reaction-label">{t.removeReaction}</span>
            </button>
          )}
        </div>,
        host
      )}
    </span>
  );
}

ReactionPicker.propTypes = {
  reaction: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onExplain: PropTypes.func,
  onReport: PropTypes.func,
  busy: PropTypes.bool,
};
