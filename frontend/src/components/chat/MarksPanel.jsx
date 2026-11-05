import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { REACTION_ICONS } from './reactionIcons';
import { copy } from '../../copy';
import { HIGHLIGHT_COLORS, shortQuote, supportsHighlights } from '../../utils/highlights';
import { marksMarkdown } from '../../utils/marks';

const t = copy.marks;
const FILTERS = ['all', ...HIGHLIGHT_COLORS, 'reactions'];

/**
 * «Мої позначки»: конспект дискусії з виділеного й реакцій.
 * Клік по фрагменту веде до репліки й відкриває його редактор.
 */
export default function MarksPanel({ entries, focusId = null, onBack, onOpen, onJump }) {
  const [filter, setFilter] = useState('all');
  const [copied, setCopied] = useState(false);
  const listRef = useRef(null);

  const total = entries.reduce(
    (sum, entry) => sum + entry.highlights.length + (entry.message.reaction ? 1 : 0),
    0
  );

  const visible = useMemo(
    () =>
      entries
        .map((entry) => ({
          ...entry,
          highlights:
            filter === 'all'
              ? entry.highlights
              : filter === 'reactions'
                ? []
                : entry.highlights.filter((item) => item.color === filter),
          showReaction: Boolean(entry.message.reaction) && (filter === 'all' || filter === 'reactions'),
        }))
        .filter((entry) => entry.highlights.length > 0 || entry.showReaction),
    [entries, filter]
  );

  // відкрили з лічильника під реплікою — гортаємо список до неї
  useEffect(() => {
    if (!focusId) return;
    listRef.current
      ?.querySelector(`[data-marks-message="${focusId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [focusId]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(marksMarkdown(entries));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="debate__panel-view marks-panel" aria-labelledby="chat-marks-title">
      <div className="debate__panel-body">
        <div className="debate__cast-head">
          <h2 id="chat-marks-title" className="debate__cast-title">
            {t.panelTitle}
            {total > 0 && <span className="debate__cast-count">{total}</span>}
          </h2>
        </div>

        {total === 0 ? (
          <div className="marks-panel__empty">
            <p>{t.panelEmpty}</p>
            <p className="marks-panel__hint">{t.panelHowTo}</p>
          </div>
        ) : (
          <>
            <div className="marks-panel__filters" role="group" aria-label={t.panelTitle}>
              {FILTERS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`debate__pill ${filter === key ? 'debate__pill--active' : ''}`}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {HIGHLIGHT_COLORS.includes(key) && <span className={`marks__dot marks__dot--${key}`} aria-hidden="true" />}
                  {key === 'all' ? t.filterAll : key === 'reactions' ? t.reactionsTitle : t.colors[key]}
                </button>
              ))}
            </div>

            <ol className="marks-panel__list" ref={listRef}>
              {visible.map(({ message, author, highlights, showReaction }) => (
                <li
                  key={message.id}
                  className={`marks-panel__group ${focusId === message.id ? 'marks-panel__group--focus' : ''}`}
                  data-marks-message={message.id}
                >
                  <div className="marks-panel__head">
                    <button type="button" className="marks-panel__author" onClick={() => onJump(message.id)} title={t.jump}>
                      {author}
                    </button>
                    {showReaction && (
                      <span className={`chat__reaction-chip chat__reaction-chip--${message.reaction} marks-panel__reaction`}>
                        <HugeiconsIcon icon={REACTION_ICONS[message.reaction]} size={13} aria-hidden="true" />
                        {t.reactions[message.reaction]}
                      </span>
                    )}
                  </div>
                  {highlights.length > 0 && (
                    <ul className="marks-panel__items">
                      {highlights.map((highlight) => (
                        <li key={highlight.id}>
                          <button
                            type="button"
                            className={`marks-panel__item marks-panel__item--${highlight.color}`}
                            onClick={() => onOpen(message, highlight)}
                          >
                            <span className="sr-only">{t.colors[highlight.color]}: </span>
                            <span className="marks-panel__quote">{shortQuote(highlight.quote, 220)}</span>
                            {highlight.note && <span className="marks-panel__note">{highlight.note}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>

            <button type="button" className="debate__pill marks-panel__copy" onClick={copyAll}>
              <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={15} aria-hidden="true" />
              {copied ? t.copied : t.copyAll}
            </button>
          </>
        )}

        <div className="marks-panel__notes">
          <p>{t.panelAi}</p>
          <p>{t.panelPrivacy}</p>
          {!supportsHighlights() && <p>{t.unsupported}</p>}
        </div>
      </div>
      <button type="button" className="debate__more-toggle debate__more-toggle--back" onClick={onBack}>
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" />
        <span className="debate__more-toggle-text">{copy.debate.back}</span>
      </button>
    </section>
  );
}

MarksPanel.propTypes = {
  entries: PropTypes.arrayOf(
    PropTypes.shape({
      message: PropTypes.object.isRequired,
      author: PropTypes.string.isRequired,
      highlights: PropTypes.arrayOf(PropTypes.object).isRequired,
    })
  ).isRequired,
  focusId: PropTypes.string,
  onBack: PropTypes.func.isRequired,
  onOpen: PropTypes.func.isRequired,
  onJump: PropTypes.func.isRequired,
};
