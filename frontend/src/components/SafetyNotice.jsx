import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircleIcon, Call02Icon, FavouriteIcon } from '@hugeicons/core-free-icons';
import { copy } from '../copy';

const t = copy.safety;

/** Криза: замість дебатів — люди, які допоможуть просто зараз.
 *  `onNotCrisis` — кнопка «Я питаю про інше», якщо ознаки кризи — лише збіг слів. */
export function CrisisHelp({ className = '', onNotCrisis, busy = false }) {
  return (
    <section className={`safety-help ${className}`} role="region" aria-labelledby="safety-help-title">
      <div className="safety-help__head">
        <span className="safety-help__icon" aria-hidden="true">
          <HugeiconsIcon icon={FavouriteIcon} size={18} />
        </span>
        <h2 id="safety-help-title" className="safety-help__title">{t.crisisTitle}</h2>
      </div>
      <p className="safety-help__lead">{t.crisisLead}</p>
      <ul className="safety-help__list">
        {t.hotlines.map((line) => (
          <li key={line.name}>
            <a
              className="safety-help__line"
              href={line.href}
              {...(line.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              <HugeiconsIcon icon={Call02Icon} size={16} aria-hidden="true" />
              <span className="safety-help__line-text">
                <span className="safety-help__line-name">{line.name}</span>
                <span className="safety-help__line-note">{line.note}</span>
              </span>
              <span className="safety-help__contact">{line.contact}</span>
            </a>
          </li>
        ))}
      </ul>
      {onNotCrisis && (
        <p className="safety-help__other">
          <span>{t.notCrisisHint}</span>
          <button type="button" className="safety-help__other-btn" onClick={onNotCrisis} disabled={busy}>
            {t.notCrisis}
          </button>
        </p>
      )}
    </section>
  );
}

CrisisHelp.propTypes = {
  className: PropTypes.string,
  onNotCrisis: PropTypes.func,
  busy: PropTypes.bool,
};

/** Здоров'я, право, великі гроші: одним рядком — що це не заміна фахівця. */
export function TopicNotice({ topic, className = '' }) {
  const text = t.topics[topic];
  if (!text) return null;
  return (
    <p className={`safety-topic ${className}`}>
      <HugeiconsIcon icon={AlertCircleIcon} size={15} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

TopicNotice.propTypes = {
  topic: PropTypes.string,
  className: PropTypes.string,
};
