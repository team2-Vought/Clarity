import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';

/**
 * Порожній стан розділу — одна розмітка на всю платформу: іконка на м'якому колі,
 * заголовок, пояснення і, за потреби, одна дія. `page` — по центру всієї області сторінки.
 */
export default function EmptyState({ icon, title, text, action, page = false, className = '' }) {
  return (
    <div className={`empty-state${page ? ' empty-state--page' : ''}${className ? ` ${className}` : ''}`}>
      {icon && (
        <span className="empty-state__icon" aria-hidden="true">
          <HugeiconsIcon icon={icon} size={26} strokeWidth={1.7} />
        </span>
      )}
      {title && <h2 className="empty-state__title">{title}</h2>}
      {text && <p className="empty-state__text">{text}</p>}
      {action && (
        <button type="button" className="empty-state__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

EmptyState.propTypes = {
  icon: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
  title: PropTypes.string,
  text: PropTypes.string,
  action: PropTypes.shape({ label: PropTypes.string.isRequired, onClick: PropTypes.func.isRequired }),
  page: PropTypes.bool,
  className: PropTypes.string,
};
