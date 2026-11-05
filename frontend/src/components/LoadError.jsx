import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert02Icon,
  Clock01Icon,
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
};

/**
 * Сторінка чи розділ не завантажилися: іконка, заголовок, пояснення людською мовою,
 * «Спробувати ще раз» і — коли винен не інтернет — «Повідомити про проблему».
 */
export default function LoadError({ kind = 'generic', text = '', onRetry, busy = false, title = '', className = '' }) {
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
  className: PropTypes.string,
};
