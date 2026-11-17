import PropTypes from 'prop-types';
import { copy } from '../copy';

const t = copy.journal;
const OUTCOMES = ['good', 'mixed', 'bad'];

/**
 * Над журналом: як часто спрацьовує порада Clarity. Рахуються рішення, де людина
 * лишила висновок без змін і вже відповіла «Як воно?» (utils/journalStats.js).
 */
export default function JournalStats({ stats }) {
  if (!stats.total) {
    return (
      <section className="journal__stats journal__stats--empty" aria-label={t.statsTitle}>
        <span className="journal__stats-label">{t.statsTitle}</span>
        <p className="journal__stats-note">{t.statsEmpty}</p>
      </section>
    );
  }
  return (
    <section className="journal__stats" aria-labelledby="journal-stats-title">
      <span id="journal-stats-title" className="journal__stats-label">{t.statsTitle}</span>
      {stats.rate === null ? (
        <p className="journal__stats-note">{t.statsNoFollowed}</p>
      ) : (
        <p className="journal__stats-rate">
          <span className="journal__stats-value">{stats.rate}%</span>
          <span className="journal__stats-text">{t.statsRateText(stats.followedGood, stats.followed)}</span>
        </p>
      )}
      <div className="journal__stats-bar" role="img" aria-label={t.statsBarLabel(stats)}>
        {OUTCOMES.map((outcome) =>
          stats[outcome] ? (
            <span
              key={outcome}
              className={`journal__stats-part journal__stats-part--${outcome}`}
              style={{ flexGrow: stats[outcome] }}
            />
          ) : null
        )}
      </div>
      <ul className="journal__stats-legend">
        {OUTCOMES.map((outcome) => (
          <li key={outcome}>
            <span className={`journal__stats-dot journal__stats-part--${outcome}`} aria-hidden="true" />
            {t.outcomes[outcome]} · {stats[outcome]}
          </li>
        ))}
      </ul>
    </section>
  );
}

JournalStats.propTypes = {
  stats: PropTypes.shape({
    total: PropTypes.number.isRequired,
    good: PropTypes.number.isRequired,
    mixed: PropTypes.number.isRequired,
    bad: PropTypes.number.isRequired,
    followed: PropTypes.number.isRequired,
    followedGood: PropTypes.number.isRequired,
    rate: PropTypes.number,
  }).isRequired,
};
