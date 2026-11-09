import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert02Icon,
  Clock01Icon,
  FileNotFoundIcon,
  RefreshIcon,
  ServerStack01Icon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import { openBugReport } from '../utils/bugReport';
import { copy } from '../copy';

const t = copy.errors.load;

// вид помилки задає іконку й відтінок: проблему видно ще до тексту
const KINDS = {
  network: { icon: WifiDisconnected01Icon, tone: 'danger' },
  server: { icon: ServerStack01Icon, tone: 'warn' },
  limit: { icon: Clock01Icon, tone: 'warn' },
  generic: { icon: Alert02Icon, tone: 'danger' },
  // запис видалено або посилання хибне — повторна спроба не допоможе
  missing: { icon: FileNotFoundIcon, tone: 'neutral' },
};

/**
 * Сторінка чи розділ не завантажилися: іконка, заголовок, пояснення людською мовою,
 * «Спробувати ще раз» і — коли винен не інтернет — «Повідомити про проблему».
 */
export default function LoadError({
  kind = 'generic',
  text = '',
  onRetry,
  busy = false,
  title = '',
  actions = [],
  className = '',
}) {
  const { icon, tone } = KINDS[kind] || KINDS.generic;
  const canReport = kind === 'server' || kind === 'generic';

  return (
    <section
      className={`load-error load-error--${tone}${className ? ` ${className}` : ''}`}
      role="alert"
      aria-live="polite"
    >
      <span className="load-error__icon" aria-hidden="true">
        <HugeiconsIcon icon={icon} size={28} strokeWidth={1.7} />
      </span>
      <h2 className="load-error__title">{title || t.titles[kind] || t.titles.generic}</h2>
      {text && <p className="load-error__text">{text}</p>}
      <div className="load-error__actions">
        {onRetry && (
          <button type="button" className="load-error__button load-error__button--primary" onClick={onRetry} disabled={busy}>
            <HugeiconsIcon
              icon={RefreshIcon}
              size={18}
              className={busy ? 'load-error__spin' : undefined}
              aria-hidden="true"
            />
            <span>{busy ? t.retrying : t.retry}</span>
          </button>
        )}
        {actions.map((action, index) => (
          <button
            key={action.label}
            type="button"
            className={`load-error__button${!onRetry && index === 0 ? ' load-error__button--primary' : ''}`}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
        {canReport && (
          <button type="button" className="load-error__button" onClick={() => openBugReport()} aria-haspopup="dialog">
            {t.report}
          </button>
        )}
      </div>
    </section>
  );
}

LoadError.propTypes = {
  kind: PropTypes.oneOf(Object.keys(KINDS)),
  text: PropTypes.string,
  onRetry: PropTypes.func,
  busy: PropTypes.bool,
  title: PropTypes.string,
  actions: PropTypes.arrayOf(
    PropTypes.shape({ label: PropTypes.string.isRequired, onClick: PropTypes.func.isRequired })
  ),
  className: PropTypes.string,
};
