import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, MinusSignIcon, PlusSignIcon } from '@hugeicons/core-free-icons';
import { FitMeter, PersonDot, STATUS_ICONS } from './parts';
import { copy } from '../../copy';

const t = copy.tree;

/** Деталі шляху: чому обрали чи відкинули, хто за нього, плюси й мінуси, розвилки. */
export default function TreeBranchDetail({ branch, colorOf, onClose }) {
  const headingRef = useRef(null);

  // фокус — на заголовок: скрінрідер одразу читає, який шлях відкрито
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [branch.id]);

  return (
    <aside id="tree-detail" className={`tree-detail tree-detail--${branch.status}`} aria-label={t.details}>
      <div className="tree-detail__head">
        <span className="tree-detail__status">
          <HugeiconsIcon icon={STATUS_ICONS[branch.status]} size={14} strokeWidth={2} aria-hidden="true" />
          {t.status[branch.status]}
        </span>
        <button type="button" className="tree-icon-button" onClick={onClose} aria-label={t.closeDetails}>
          <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden="true" />
        </button>
      </div>

      <h3 className="tree-detail__title" ref={headingRef} tabIndex={-1}>
        {branch.title}
      </h3>
      {branch.summary && <p className="tree-detail__summary">{branch.summary}</p>}
      <FitMeter value={branch.fit} />

      {branch.why && (
        <section className="tree-detail__block tree-detail__why">
          <h4 className="tree-detail__label">{t.why[branch.status]}</h4>
          <p>{branch.why}</p>
        </section>
      )}

      <section className="tree-detail__block">
        <h4 className="tree-detail__label">{t.supporters}</h4>
        {branch.supporters.length ? (
          <ul className="tree-detail__people">
            {branch.supporters.map((person) => (
              <li key={person.name}>
                <PersonDot person={person} colorOf={colorOf} size={28} />
                <span>{person.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tree-detail__muted">{t.noSupporters}</p>
        )}
      </section>

      {(branch.pros.length > 0 || branch.cons.length > 0) && (
        <div className="tree-detail__columns">
          {branch.pros.length > 0 && (
            <section className="tree-detail__block">
              <h4 className="tree-detail__label">{t.pros}</h4>
              <ul className="tree-detail__points tree-detail__points--pro">
                {branch.pros.map((item) => (
                  <li key={item}>
                    <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2.2} aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {branch.cons.length > 0 && (
            <section className="tree-detail__block">
              <h4 className="tree-detail__label">{t.cons}</h4>
              <ul className="tree-detail__points tree-detail__points--con">
                {branch.cons.map((item) => (
                  <li key={item}>
                    <HugeiconsIcon icon={MinusSignIcon} size={14} strokeWidth={2.2} aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <section className="tree-detail__block">
        <h4 className="tree-detail__label">{t.outcomes}</h4>
        {branch.outcomes.length ? (
          <ol className="tree-detail__outcomes">
            {branch.outcomes.map((outcome) => (
              <li key={outcome.id} className={`tree-outcome tree-outcome--${outcome.tone} tree-outcome--flat`}>
                <span className="tree-outcome__dot" aria-hidden="true" />
                <span className="tree-outcome__tone">{t.tone[outcome.tone]}</span>
                {outcome.condition && <span className="tree-outcome__if">{outcome.condition}</span>}
                {outcome.result && <span className="tree-outcome__then">{outcome.result}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="tree-detail__muted">{t.outcomesEmpty}</p>
        )}
      </section>
    </aside>
  );
}

TreeBranchDetail.propTypes = {
  branch: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    status: PropTypes.oneOf(['chosen', 'alternative', 'rejected']).isRequired,
    summary: PropTypes.string,
    fit: PropTypes.number,
    why: PropTypes.string,
    supporters: PropTypes.array.isRequired,
    pros: PropTypes.array.isRequired,
    cons: PropTypes.array.isRequired,
    outcomes: PropTypes.array.isRequired,
  }).isRequired,
  colorOf: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
