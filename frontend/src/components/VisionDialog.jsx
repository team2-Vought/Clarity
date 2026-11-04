import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, ViewIcon } from '@hugeicons/core-free-icons';
import VisionPanel from './VisionPanel';
import { copy } from '../copy';
import { OPEN_VISION_EVENT, isVisionShortcut, openVisionPanel } from '../utils/vision';

const t = copy.vision;

/**
 * Панель «Зручність для зору» поверх будь-якої сторінки.
 * Відкривається кнопкою «Для слабозорих», пунктом меню або поєднанням клавіш.
 * Нативний <dialog> сам тримає фокус усередині, закривається Escape й
 * повертає фокус туди, звідки його відкрили.
 */
export default function VisionDialog() {
  const dialogRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const show = () => setOpen(true);
    const handleKey = (e) => {
      if (!isVisionShortcut(e)) return;
      e.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener(OPEN_VISION_EVENT, show);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener(OPEN_VISION_EVENT, show);
      window.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="vision-dialog"
      aria-labelledby="vision-dialog-title"
      onClose={() => setOpen(false)}
      // клік по затемненню довкола картки закриває панель
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="vision-dialog__head">
        <h2 id="vision-dialog-title" className="vision-dialog__title">
          {t.title}
        </h2>
        <button
          type="button"
          className="vision-dialog__close"
          onClick={() => setOpen(false)}
          aria-label={t.close}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={22} aria-hidden="true" />
        </button>
      </div>
      <div className="vision-dialog__body">
        {open && <VisionPanel onAnnounce={setAnnouncement} />}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </dialog>
  );
}

/** Кнопка «Для слабозорих» для сторінок без меню застосунку (лендинг, вхід, публічні сторінки). */
export function VisionTrigger({ compact = false, className = '' }) {
  return (
    <button
      type="button"
      className={`vision-trigger ${compact ? 'vision-trigger--compact' : ''} ${className}`.trim()}
      onClick={openVisionPanel}
      aria-label={compact ? t.triggerAria : undefined}
      aria-haspopup="dialog"
      title={t.triggerAria}
    >
      <HugeiconsIcon icon={ViewIcon} size={20} aria-hidden="true" />
      <span className="vision-trigger__label">{t.trigger}</span>
    </button>
  );
}

VisionTrigger.propTypes = {
  compact: PropTypes.bool,
  className: PropTypes.string,
};
