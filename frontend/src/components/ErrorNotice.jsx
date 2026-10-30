import { Fragment } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert02Icon,
  AlertCircleIcon,
  Clock01Icon,
  CloudOffIcon,
  Exchange01Icon,
  InformationCircleIcon,
  Key01Icon,
  PauseIcon,
  ServerStack01Icon,
  Wallet01Icon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import { copy } from '../copy';

// Вид помилки задає іконку, колір і заголовок: проблему видно ще до тексту
const KINDS = {
  quota: { icon: Wallet01Icon, tone: 'warn' },
  config: { icon: Key01Icon, tone: 'danger' },
  provider: { icon: CloudOffIcon, tone: 'warn' },
  limit: { icon: Clock01Icon, tone: 'warn' },
  followups: { icon: InformationCircleIcon, tone: 'info' },
  network: { icon: WifiDisconnected01Icon, tone: 'danger' },
  server: { icon: ServerStack01Icon, tone: 'danger' },
  input: { icon: AlertCircleIcon, tone: 'warn' },
  stopped: { icon: PauseIcon, tone: 'neutral' },
  modelChanged: { icon: Exchange01Icon, tone: 'info' },
  generic: { icon: Alert02Icon, tone: 'danger' },
};

const PARTICIPANT_PREFIX = /^([^:«»\n]{1,40}):\s+([\s\S]+)$/;

// назву моделі в «лапках» виділяємо — її зазвичай і треба змінити
function emphasize(text) {
  return text.split(/(«[^»]+»)/).map((part, index) =>
    part.startsWith('«') ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>
  );
}

export default function ErrorNotice({ kind = 'generic', text = '', who = false, actions = [], className = '' }) {
  const { icon, tone } = KINDS[kind] || KINDS.generic;
  const title = copy.errors.titles[kind] || copy.errors.titles.generic;

  // сервер додає до тексту ім'я учасника («Учасник 2: …») — показуємо його міткою
  const match = who ? PARTICIPANT_PREFIX.exec(text) : null;
  const participant = match?.[1];
  const body = match ? match[2] : text;

  return (
    <div
      className={`notice notice--${tone}${className ? ` ${className}` : ''}`}
      role={tone === 'neutral' || tone === 'info' ? 'status' : 'alert'}
      aria-live="polite"
    >
      <span className="notice__icon" aria-hidden="true">
        <HugeiconsIcon icon={icon} size={18} strokeWidth={1.8} />
      </span>
      <div className="notice__content">
        <p className="notice__title">
          {title}
          {participant && <span className="notice__who">{participant}</span>}
        </p>
        {body && <p className="notice__text">{who ? emphasize(body) : body}</p>}
        {actions.length > 0 && (
          <div className="notice__actions">
            {actions.map((action, index) => (
              <button
                key={action.label}
                type="button"
                className={`notice__button${index === 0 ? ' notice__button--primary' : ''}`}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

ErrorNotice.propTypes = {
  kind: PropTypes.oneOf(Object.keys(KINDS)),
  text: PropTypes.string,
  who: PropTypes.bool,
  actions: PropTypes.arrayOf(
    PropTypes.shape({ label: PropTypes.string.isRequired, onClick: PropTypes.func.isRequired })
  ),
  className: PropTypes.string,
};
