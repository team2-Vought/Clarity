import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { InlineText } from './MessageMarkdown';
import { describeVerdict } from '../utils/summary';
import { copy } from '../copy';

const t = copy.chat;

const listFor = (view, key) => view.lists.find((list) => list.key === key)?.items || [];

function Bullets({ id, title, items, sources }) {
  if (!items.length) return null;
  return (
    <section className={`chat__summary-group chat__summary-group--${id}`}>
      <h4 className="chat__summary-label">{title}</h4>
      <ul>
        {items.map((item, itemIndex) => (
          <li key={`${id}-${itemIndex}`}>
            <InlineText text={item} sources={sources} />
          </li>
        ))}
      </ul>
    </section>
  );
}

Bullets.propTypes = {
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  items: PropTypes.arrayOf(PropTypes.string).isRequired,
  sources: PropTypes.instanceOf(Map).isRequired,
};

/** Пункт і що з ним робити: ризик → як зменшити, невідоме → як з'ясувати. */
function Pairs({ id, title, items, noteLabel, sources }) {
  if (!items.length) return null;
  return (
    <section className={`chat__summary-group chat__summary-group--${id}`}>
      <h4 className="chat__summary-label">{title}</h4>
      <ul className="chat__summary-pairs">
        {items.map((item, itemIndex) => (
          <li key={`${id}-${itemIndex}`}>
            <span className="chat__summary-pair-main">
              <InlineText text={item.main} sources={sources} />
            </span>
            {item.note && (
              <span className="chat__summary-pair-note">
                <span className="chat__summary-pair-label">{noteLabel}</span>
                <InlineText text={item.note} sources={sources} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

Pairs.propTypes = {
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  items: PropTypes.arrayOf(PropTypes.shape({ main: PropTypes.string, note: PropTypes.string })).isRequired,
  noteLabel: PropTypes.string.isRequired,
  sources: PropTypes.instanceOf(Map).isRequired,
};

/**
 * Зміст підсумку дискусії. Головна відповідь виглядає по-різному залежно від
 * формату: велике «ТАК»/«НІ», усі варіанти з голосами й виділеним переможцем
 * або рішення-стаття для вільної відповіді. Далі однаково для всіх форматів:
 * вердикт одним реченням, рядок згоди й оцінки та розділи, розділені тонкими
 * лініями: перегляд після AI Devil, умови, план (спершу — дії), що з'ясувати,
 * аргументи, ризики з тим, як їх зменшити, план Б, коли передумати, окремі думки. Спільний для чату, публічного
 * посилання й демо на лендингу.
 * `animate` — блоки проявляються по черзі (CSS-змінна --i).
 * `paths` — розділ «Розглянуті шляхи» (лише в чаті): після перегляду, перед аргументами.
 */
export default function SummaryDetails({
  summary,
  view,
  sources,
  mode = 'open',
  options = [],
  animate = false,
  paths = null,
}) {
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

        {/* вердикт одним реченням — те, що людина запам'ятає */}
        {view.headline && (
          <p className="chat__summary-tagline">
            <InlineText text={view.headline} sources={sources} />
          </p>
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

      {(revision || paths || view.lists.length > 0 || nextStep || plan.length > 0 || triggers.length > 0) && (
        <div className="chat__summary-sections" style={step()}>
          {revision && (
            <section className="chat__summary-group chat__summary-group--revision">
              <h4 className="chat__summary-label">{t.summaryRevision}</h4>
              <p>
                <InlineText text={revision} sources={sources} />
              </p>
            </section>
          )}
          <Bullets id="conditions" title={t.summaryConditions} items={view.conditions || []} sources={sources} />
          {/* план — одразу після вердикту: перший крок виділено, решта — на тиждень */}
          {plan.length > 0 && (
            <section className="chat__summary-group chat__summary-group--plan">
              <h4 className="chat__summary-label">{t.summaryPlan}</h4>
              <ol className="chat__summary-plan">
                {plan.map((item, itemIndex) => (
                  <li key={`plan-${itemIndex}`} className={itemIndex === 0 ? 'chat__summary-plan-first' : undefined}>
                    <span className="chat__summary-plan-num" aria-hidden="true">{itemIndex + 1}</span>
                    <span>
                      {itemIndex === 0 && <span className="chat__summary-plan-tag">{t.summaryFirstStep}</span>}
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
          <Pairs id="unknowns" title={t.summaryUnknowns} items={view.unknowns || []} noteLabel={t.summaryUnknownHow} sources={sources} />
          {paths}
          <Bullets id="pros" title={t.summaryPros} items={listFor(view, 'pros')} sources={sources} />
          <Bullets id="cons" title={t.summaryCons} items={listFor(view, 'cons')} sources={sources} />
          <Pairs id="risks" title={t.summaryRisks} items={view.riskPlan || []} noteLabel={t.summaryRiskMitigation} sources={sources} />
          {view.planB && (
            <section className="chat__summary-group chat__summary-group--planB">
              <h4 className="chat__summary-label">{t.summaryPlanB}</h4>
              <p>
                <InlineText text={view.planB} sources={sources} />
              </p>
            </section>
          )}
          <Bullets id="triggers" title={t.summaryTriggers} items={triggers} sources={sources} />
          <Bullets id="dissent" title={t.summaryDissent} items={view.dissent || listFor(view, 'dissent')} sources={sources} />
        </div>
      )}
    </>
  );
}

SummaryDetails.propTypes = {
  summary: PropTypes.object.isRequired,
  view: PropTypes.shape({
    headline: PropTypes.string,
    decision: PropTypes.string,
    confirmed: PropTypes.bool,
    confidence: PropTypes.number,
    agreement: PropTypes.object,
    lists: PropTypes.array.isRequired,
    plan: PropTypes.arrayOf(PropTypes.string),
    triggers: PropTypes.arrayOf(PropTypes.string),
  }).isRequired,
  sources: PropTypes.instanceOf(Map).isRequired,
  paths: PropTypes.node,
  mode: PropTypes.oneOf(['open', 'yes_no', 'choose_one']),
  options: PropTypes.arrayOf(PropTypes.string),
  animate: PropTypes.bool,
};
