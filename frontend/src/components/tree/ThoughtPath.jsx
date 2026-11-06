import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { PersonDot, STAGE_ICONS } from './parts';
import { copy } from '../../copy';

const t = copy.tree;

/** Хід думок команди: від питання через суперечки й перелом до висновку. */
export default function ThoughtPath({ steps, colorOf }) {
  if (!steps?.length) return null;
  return (
    <section
      className={`tree-path ${steps.length >= 5 ? 'tree-path--many' : ''}`}
      style={{ '--steps': steps.length }}
      aria-labelledby="tree-path-title"
    >
      <div className="tree-path__head">
        <h3 id="tree-path-title" className="tree-path__title">{t.path}</h3>
      </div>
      <ol className="tree-path__steps">
        {steps.map((step, index) => (
          <li key={`${step.stage}-${index}`} className={`tree-step tree-step--${step.stage}`} style={{ '--i': index }}>
            <span className="tree-step__marker" aria-hidden="true">
              <HugeiconsIcon icon={STAGE_ICONS[step.stage] || STAGE_ICONS.debate} size={16} strokeWidth={1.9} />
            </span>
            <div className="tree-step__body">
              <span className="tree-step__stage">{t.stages[step.stage] || t.stages.debate}</span>
              <span className="tree-step__title">{step.title}</span>
              {step.text && <p className="tree-step__text">{step.text}</p>}
              {step.who?.name && (
                <span className="tree-step__who">
                  <PersonDot person={step.who} colorOf={colorOf} size={20} />
                  {step.who.name}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

ThoughtPath.propTypes = {
  steps: PropTypes.arrayOf(
    PropTypes.shape({
      stage: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      text: PropTypes.string,
      who: PropTypes.object,
    })
  ),
  colorOf: PropTypes.func.isRequired,
};
