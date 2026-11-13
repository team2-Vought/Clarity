import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { roleIcon } from '../utils/debateOptions';

/**
 * Аватарки команди: троє стають трикутником (одна згори, дві під нею),
 * двоє чи четверо-п'ятеро — в ряд із легким перекриттям.
 * Колір і значок — за роллю учасника.
 */
export default function TeamAvatars({ members, size = 'md', layout: forced = '', max = 0, className = '' }) {
  // троє — трикутником, якщо ряд не задано явно (кнопка учасників у чаті — завжди ряд)
  const layout = forced || (members.length === 3 ? 'triad' : 'row');
  const shown = max > 0 ? members.slice(0, max) : members;
  const hidden = members.length - shown.length;
  return (
    <span className={`team-avatars team-avatars--${layout} team-avatars--${size} ${className}`} aria-hidden="true">
      {shown.map((member) => (
        <span key={member.key} className="team-avatars__item" style={{ '--chip': member.color }}>
          <HugeiconsIcon icon={roleIcon(member.key)} size={size === 'sm' ? 12 : 15} strokeWidth={1.9} />
        </span>
      ))}
      {/* решта — числом: ширина не росте з кількістю учасників */}
      {hidden > 0 && <span className="team-avatars__item team-avatars__more">+{hidden}</span>}
    </span>
  );
}

TeamAvatars.propTypes = {
  members: PropTypes.arrayOf(
    PropTypes.shape({ key: PropTypes.string.isRequired, color: PropTypes.string })
  ).isRequired,
  size: PropTypes.oneOf(['sm', 'md']),
  layout: PropTypes.oneOf(['', 'row', 'triad']),
  // скільки аватарок показати; решта — «+N»
  max: PropTypes.number,
  className: PropTypes.string,
};
