import PropTypes from 'prop-types';
import { InlineText } from './MessageMarkdown';
import { uk } from '../copy/uk';

const t = uk.chat;

/**
 * Зміст підсумку дискусії: відповідь, рішення, перегляд, згода, списки й
 * наступний крок. Спільний для чату й публічного посилання.
 * `animate` — частини проявляються по черзі (CSS-змінна --i).
 */
export default function SummaryDetails({ summary, view, sources, animate = false }) {
  let index = 0;
  const step = () => (animate ? { '--i': index++ } : undefined);
  return (
    <>
      {summary?.answer && (
        <div className="chat__summary-item" style={step()}>
          <span className="chat__summary-label">{t.summaryAnswer}</span>
          <p>
            <InlineText text={String(summary.answer)} sources={sources} />
          </p>
        </div>
      )}
      <div className="chat__summary-item" style={step()}>
        <span className="chat__summary-label">{t.view.decision}</span>
        <p>
          <InlineText text={view.decision} sources={sources} />
        </p>
      </div>
      {view.confirmed === false && summary?.revision && (
        <div className="chat__summary-item" style={step()}>
          <span className="chat__summary-label">{t.summaryRevision}</span>
          <p>
            <InlineText text={String(summary.revision)} sources={sources} />
          </p>
        </div>
      )}
      {(view.agreement || view.confidence !== null) && (
        <div className="chat__summary-meta" style={step()}>
          {view.agreement && (
            <div className="chat__summary-item">
              <span className="chat__summary-label">{t.summaryAgreement}</span>
              <p>{t.summaryAgreementValue(view.agreement.agree, view.agreement.total)}</p>
            </div>
          )}
          {view.confidence !== null && (
            <div className="chat__summary-item" title={t.view.confidenceHint}>
              <span className="chat__summary-label">{t.view.confidence}</span>
              <p>{view.confidence}%</p>
            </div>
          )}
        </div>
      )}
      {view.lists.length > 0 && (
        <table className="chat__summary-table">
          <tbody>
            {view.lists.map(({ key, title, items }) => (
              <tr key={key} style={step()}>
                <th scope="row">
                  <span className="chat__summary-label">{title}</span>
                </th>
                <td>
                  <ul>
                    {items.map((item, itemIndex) => (
                      <li key={`${key}-${itemIndex}`}>
                        <InlineText text={item} sources={sources} />
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {summary?.recommendation && (
        <div className="chat__summary-item" style={step()}>
          <span className="chat__summary-label">{t.summaryNextStep}</span>
          <p>
            <InlineText text={String(summary.recommendation)} sources={sources} />
          </p>
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
  }).isRequired,
  sources: PropTypes.instanceOf(Map).isRequired,
  animate: PropTypes.bool,
};
