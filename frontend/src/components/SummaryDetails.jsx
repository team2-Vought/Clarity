import { useId, useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
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

/** «Один із варіантів»: кожен варіант — за й проти, обраний виділено. */
function CompareTable({ rows, answer = '', sources }) {
  const chosen = String(answer || '').trim().toLowerCase();
  return (
    <section className="chat__summary-group chat__summary-group--compare">
      <h4 className="chat__summary-label">{t.summaryCompare}</h4>
      <div className="chat__compare-wrap">
        <table className="chat__compare">
          <thead>
            <tr>
              <th scope="col">{t.summaryCompareOption}</th>
              <th scope="col">{t.summaryComparePro}</th>
              <th scope="col">{t.summaryCompareCon}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isChosen = row.option.trim().toLowerCase() === chosen;
              return (
                <tr key={row.option} className={isChosen ? 'chat__compare-row--chosen' : undefined}>
                  <th scope="row">
                    {isChosen && <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden="true" />}
                    {row.option}
                    {isChosen && <span className="chat__summary-sr">{` — ${t.summaryWinner}`}</span>}
                  </th>
                  <td>{row.pro ? <InlineText text={row.pro} sources={sources} /> : '—'}</td>
                  <td>{row.con ? <InlineText text={row.con} sources={sources} /> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

CompareTable.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.shape({ option: PropTypes.string, pro: PropTypes.string, con: PropTypes.string })).isRequired,
  answer: PropTypes.string,
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
  collapsible = true,
}) {
  // коротко — вердикт, рішення, умови, план на тиждень і ризики; решта — за «Повним розбором»
  const [isFullOpen, setIsFullOpen] = useState(!collapsible);
  let index = 0;
  const step = () => (animate ? { '--i': index++ } : undefined);
  const verdict = describeVerdict(summary, mode, options);
  const isArticle = verdict.kind === 'open';
  const revision = view.confirmed === false && summary?.revision ? String(summary.revision) : '';
  const plan = view.plan || [];
  const triggers = view.triggers || [];
  // старі підсумки не мають плану — тоді лишається один «наступний крок»
  const nextStep = plan.length === 0 && summary?.recommendation ? String(summary.recommendation) : '';
  const compare = view.compare || [];
  const fullId = useId();
  // чи є що показати в «Повному розборі»
  const hasMore = Boolean(
    revision
    || paths
    || compare.length
    || view.unknowns?.length
    || view.planB
    || triggers.length
    || view.dissent?.length
    || listFor(view, 'pros').length
    || listFor(view, 'cons').length
  );

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
          <Bullets id="conditions" title={t.summaryConditions} items={view.conditions || []} sources={sources} />
          {/* план на тиждень одразу у висновку: перший крок виділено — з нього людина почне */}
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
          {/* старі підсумки без плану — лише один наступний крок */}
          {nextStep && (
            <section className="chat__summary-group chat__summary-group--first">
              <h4 className="chat__summary-label">{t.summaryFirstStep}</h4>
              <p className="chat__summary-first">
                <InlineText text={nextStep} sources={sources} />
              </p>
            </section>
          )}
          <Pairs id="risks" title={t.summaryRisks} items={view.riskPlan || []} noteLabel={t.summaryRiskMitigation} sources={sources} />

          {hasMore && collapsible && (
            <button
              type="button"
              className="chat__summary-more"
              onClick={() => setIsFullOpen((open) => !open)}
              aria-expanded={isFullOpen}
              aria-controls={fullId}
            >
              {isFullOpen ? t.summaryLess : t.summaryMore}
              <HugeiconsIcon icon={ArrowDown01Icon} size={16} aria-hidden="true" />
            </button>
          )}

          {hasMore && isFullOpen && (
            <div id={fullId} className="chat__summary-full">
              {revision && (
                <section className="chat__summary-group chat__summary-group--revision">
                  <h4 className="chat__summary-label">{t.summaryRevision}</h4>
                  <p>
                    <InlineText text={revision} sources={sources} />
                  </p>
                </section>
              )}
              {compare.length > 0 && <CompareTable rows={compare} answer={summary?.answer} sources={sources} />}
              <Pairs id="unknowns" title={t.summaryUnknowns} items={view.unknowns || []} noteLabel={t.summaryUnknownHow} sources={sources} />
              {paths}
              <Bullets id="pros" title={t.summaryPros} items={listFor(view, 'pros')} sources={sources} />
              <Bullets id="cons" title={t.summaryCons} items={listFor(view, 'cons')} sources={sources} />
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
  collapsible: PropTypes.bool,
  mode: PropTypes.oneOf(['open', 'yes_no', 'choose_one']),
  options: PropTypes.arrayOf(PropTypes.string),
  animate: PropTypes.bool,
};
