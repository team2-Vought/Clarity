import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Cancel01Icon,
  Doc01Icon,
  File01Icon,
  Image01Icon,
  Loading03Icon,
  Pdf01Icon,
} from '@hugeicons/core-free-icons';

const KIND_ICONS = { pdf: Pdf01Icon, docx: Doc01Icon, image: Image01Icon, text: File01Icon };

/** Файл біля питання: тип, назва, стан читання; хрестик — прибрати (поки дискусію не створено). */
export default function AttachmentChip({ name, kind = '', status = 'ready', title, onRemove, removeLabel }) {
  const icon = status === 'reading' ? Loading03Icon : KIND_ICONS[kind] || File01Icon;
  return (
    <span className={`attachment-chip attachment-chip--${status}`} title={title || name}>
      <HugeiconsIcon
        icon={icon}
        size={15}
        className={status === 'reading' ? 'attachment-chip__spin' : undefined}
        aria-hidden="true"
      />
      <span className="attachment-chip__name">{name}</span>
      {onRemove && (
        <button
          type="button"
          className="attachment-chip__remove"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

AttachmentChip.propTypes = {
  name: PropTypes.string.isRequired,
  kind: PropTypes.string,
  status: PropTypes.oneOf(['reading', 'ready', 'error']),
  title: PropTypes.string,
  onRemove: PropTypes.func,
  removeLabel: PropTypes.string,
};
