import PropTypes from 'prop-types';
import { copy } from '../../copy';

const t = copy.chat;
const STAGES = ['opening', 'debate', 'synthesis', 'devil', 'rebuttal', 'final'];

/**
 * Де дискусія зараз: «Крок 2 з 6 · Дебати» і смужка з етапів. Показується
 * лише під час повної дискусії — швидка відповідь чи відповідь одному
 * учаснику етапів не мають.
 */
export default function StageProgress({ phase }) {
  const index = STAGES.indexOf(phase);
  if (index < 0) return null;
  const label = t.stages[phase];
  return (
    <div className="chat__stages" role="group" aria-label={t.stagesLabel}>
      <ol className="chat__stages-bar" aria-hidden="true">
        {STAGES.map((stage, i) => (
          <li
            key={stage}
            data-state={i < index ? 'done' : i === index ? 'current' : undefined}
          />
        ))}
      </ol>
      <span className="chat__stages-text">{t.stageOf(index + 1, STAGES.length, label)}</span>
    </div>
  );
}

StageProgress.propTypes = {
  phase: PropTypes.string,
};
