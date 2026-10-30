import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { InlineText } from './MessageMarkdown';
import { describeVerdict } from '../utils/summary';
import { copy } from '../copy';

const t = copy.chat;

/**
 * Зміст підсумку дискусії. Головна відповідь виглядає по-різному залежно від
 * формату: велике «ТАК»/«НІ», усі варіанти з голосами й виділеним переможцем
 * або рішення-стаття для вільної відповіді. Далі однаково для всіх форматів:
 * рядок згоди й оцінки та розділи, розділені тонкими лініями, — перегляд після
 * AI Devil, аргументи й наступний крок. Спільний для чату, публічного
 * посилання й демо на лендингу.
 * `animate` — блоки проявляються по черзі (CSS-змінна --i).
 */
export default function SummaryDetails({ summary, view, sources, mode = 'open', options = [], animate = false }) {
  let index = 0;
  const step = () => (animate ? { '--i': index++ } : undefined);
  const verdict = describeVerdict(summary, mode, options);
  const isArticle = verdict.kind === 'open';
  const revision = view.confirmed === false && summary?.revision ? String(summary.revision) : '';
  const plan = view.plan || [];
  const triggers = view.triggers || [];
  // старі підсумки не мають плану — тоді лишається один «наступний крок»
  const nextStep = plan.length === 0 && summary?.recommendation ? String(summary.recommendation) : '';

  return (
    <>
      <div className={`chat__summary-verdict chat__summary-verdict--${verdict.kind}`} style={step()}>
        <span className="chat__summary-label">
          {isArticle ? t.summaryConclusion : t.summaryVerdict}
        </span>

        {verdict.kind === 'yes_no' && (
          <p className={`chat__summary-word chat__summary-word--${verdict.yes ? 'yes' : 'no'}`}>
            {verdict.yes ? t.summaryYes : t.summaryNo}
          </p>
        )}

        {verdict.kind === 'choice' && (
          <ul className="chat__summary-options">
            {verdict.options.map((option, optionIndex) => {
              const share = verdict.total ? option.votes / verdict.total : 0;
              return (
                <li
                  key={option.label}
                  className={`chat__summary-option ${option.winner ? 'chat__summary-option--winner' : ''}`}
                  style={{ '--share': share }}
                >
                  <span className="chat__summary-option-mark" aria-hidden="true">
                    {option.winner ? <HugeiconsIcon icon={Tick02Icon} size={16} /> : optionIndex + 1}
                  </span>
                  <span className="chat__summary-option-label">
                    {option.label}
                    {option.winner && <span className="chat__summary-sr">{` — ${t.summaryWinner}`}</span>}
                  </span>
                  {verdict.hasVotes && (
                    <>
                      <span className="chat__summary-option-votes">{t.summaryVotes(option.votes)}</span>
                      <span className="chat__summary-option-bar" aria-hidden="true">
                        <span />
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {isArticle && summary?.answer && (
          <h3 className="chat__summary-headline">
            <InlineText text={String(summary.answer)} sources={sources} />
          </h3>
        )}

        <p className="chat__summary-decision">
          <InlineText text={view.decision} sources={sources} />
        </p>
      </div>

      {(view.agreement || view.confidence !== null) && (
        <div className="chat__summary-stats" style={step()}>
          {view.agreement && (
            <div className="chat__summary-stat">
              <span className="chat__summary-label">{t.summaryAgreement}</span>
              <span className="chat__summary-stat-value">
                {view.agreement.agree}
                <small>{t.summaryAgreementOf(view.agreement.total)}</small>
              </span>
            </div>
          )}
          {view.confidence !== null && (
            <div className="chat__summary-stat" title={t.summaryConfidenceHint}>
              <span className="chat__summary-label">{t.summaryConfidence}</span>
              <span className="chat__summary-stat-value">
                {view.confidence}
                <small>%</small>
              </span>
              <span className="chat__summary-meter" aria-hidden="true">
                <span style={{ width: `${view.confidence}%` }} />
              </span>
            </div>
          )}
        </div>
      )}

      {(revision || view.lists.length > 0 || nextStep || plan.length > 0 || triggers.length > 0) && (
        <div className="chat__summary-sections" style={step()}>
          {revision && (
            <section className="chat__summary-group chat__summary-group--revision">
              <h4 className="chat__summary-label">{t.summaryRevision}</h4>
              <p>
                <InlineText text={revision} sources={sources} />
              </p>
            </section>
          )}
          {view.lists.map(({ key, title, items }) => (
            <section key={key} className={`chat__summary-group chat__summary-group--${key}`}>
              <h4 className="chat__summary-label">{title}</h4>
              <ul>
                {items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>
                    <InlineText text={item} sources={sources} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {plan.length > 0 && (
            <section className="chat__summary-group chat__summary-group--plan">
              <h4 className="chat__summary-label">{t.summaryPlan}</h4>
              <ol className="chat__summary-plan">
                {plan.map((item, itemIndex) => (
                  <li key={`plan-${itemIndex}`}>
                    <span className="chat__summary-plan-num" aria-hidden="true">{itemIndex + 1}</span>
                    <span>
                      <InlineText text={item} sources={sources} />
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {nextStep && (
            <section className="chat__summary-group chat__summary-group--next">
              <h4 className="chat__summary-label">{t.summaryNextStep}</h4>
              <p>
                <InlineText text={nextStep} sources={sources} />
              </p>
            </section>
          )}
          {triggers.length > 0 && (
            <section className="chat__summary-group chat__summary-group--triggers">
              <h4 className="chat__summary-label">{t.summaryTriggers}</h4>
              <ul>
                {triggers.map((item, itemIndex) => (
                  <li key={`trigger-${itemIndex}`}>
                    <InlineText text={item} sources={sources} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}

SummaryDetails.propTypes = {
  summary: PropTypes.object.isRequired,
  view: PropTypes.shape({
    decision: PropTypes.string,
    confirmed: PropTypes.bool,
    confidence: PropTypes.number,
    agreement: PropTypes.object,
    lists: PropTypes.array.isRequired,
    plan: PropTypes.arrayOf(PropTypes.string),
    triggers: PropTypes.arrayOf(PropTypes.string),
  }).isRequired,
  sources: PropTypes.instanceOf(Map).isRequired,
  mode: PropTypes.oneOf(['open', 'yes_no', 'choose_one']),
  options: PropTypes.arrayOf(PropTypes.string),
  animate: PropTypes.bool,
};
