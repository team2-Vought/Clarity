import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { copy } from '../copy';

const t = copy.debate;

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toUpperCase() : '');

/**
 * Файл у полі питання — картка, як у Claude: фото показує мініатюру,
 * документ — назву й тип. Клік відкриває перегляд; хрестик — прибрати.
 * file: { name, status, kind, url, source, preview, truncated }; url — локальна
 * адреса самого файлу (сервер зберігає лише текст), source — сам File.
 */
export default function AttachmentCard({ file, onRemove, removeLabel, title }) {
  const [isViewing, setIsViewing] = useState(false);
  const reading = file.status === 'reading';
  const isImage = file.kind === 'image' && file.url;

  return (
    <div
      className={[
        'attachment-card',
        isImage ? 'attachment-card--image' : 'attachment-card--doc',
        reading && 'attachment-card--reading',
      ].filter(Boolean).join(' ')}
      title={title}
    >
      <button
        type="button"
        className="attachment-card__open"
        onClick={() => setIsViewing(true)}
        disabled={reading}
        aria-label={t.attachOpen(file.name)}
      >
        {isImage ? (
          <img className="attachment-card__thumb" src={file.url} alt="" />
        ) : (
          <>
            <span className="attachment-card__name">{file.name}</span>
            <span className="attachment-card__type">{extOf(file.name)}</span>
          </>
        )}
      </button>
      {reading && <span className="attachment-card__spinner" aria-label={t.attachReading} role="status" />}
      {onRemove && (
        <button
          type="button"
          className="attachment-card__remove"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2.4} aria-hidden="true" />
        </button>
      )}
      {isViewing && <AttachmentViewer file={file} onClose={() => setIsViewing(false)} />}
    </div>
  );
}

/** Перегляд вкладення: фото й PDF — сам файл, текст — його вміст, Word — початок тексту. */
function AttachmentViewer({ file, onClose }) {
  const id = useId();
  const [text, setText] = useState(null);
  const ext = extOf(file.name).toLowerCase();
  const isPdf = ext === 'pdf' && file.url;
  const isPlain = ['txt', 'md', 'csv'].includes(ext) && file.source;

  useEffect(() => {
    if (!isPlain) return undefined;
    let alive = true;
    file.source.text().then((value) => alive && setText(value)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [file.source, isPlain]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  let body;
  if (file.kind === 'image' && file.url) {
    body = <img className="attachment-viewer__image" src={file.url} alt={file.name} />;
  } else if (isPdf) {
    body = <iframe className="attachment-viewer__frame" src={file.url} title={file.name} />;
  } else {
    body = (
      <>
        <pre className="attachment-viewer__text">{isPlain ? text ?? '' : `${file.preview || ''}…`}</pre>
        {!isPlain && <p className="attachment-viewer__note">{t.attachPreviewNote}</p>}
      </>
    );
  }

  return createPortal(
    // тло й кольори теми — як у діалозі своєї ролі
    <div className="role-dialog__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="attachment-viewer" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <header className="attachment-viewer__head">
          <h2 id={`${id}-title`} className="attachment-viewer__title">{file.name}</h2>
          <button
            type="button"
            className="attachment-viewer__close"
            onClick={onClose}
            aria-label={t.attachClose}
            title={t.attachClose}
            // діалог щойно відкрився — фокус на «Закрити», щоб Esc і Enter працювали одразу
            autoFocus
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
          </button>
        </header>
        {body}
        {file.truncated && <p className="attachment-viewer__note">{t.attachTruncated}</p>}
      </div>
    </div>,
    document.body
  );
}

const filePropType = PropTypes.shape({
  name: PropTypes.string.isRequired,
  status: PropTypes.oneOf(['reading', 'ready', 'error']),
  kind: PropTypes.string,
  url: PropTypes.string,
  source: PropTypes.object,
  preview: PropTypes.string,
  truncated: PropTypes.bool,
});

AttachmentCard.propTypes = {
  file: filePropType.isRequired,
  onRemove: PropTypes.func,
  removeLabel: PropTypes.string,
  title: PropTypes.string,
};

AttachmentViewer.propTypes = {
  file: filePropType.isRequired,
  onClose: PropTypes.func.isRequired,
};
