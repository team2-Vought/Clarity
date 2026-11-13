import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { roleIcon } from '../utils/debateOptions';

/**
 * Аватарки команди: троє стають трикутником (одна згори, дві під нею),
 * двоє чи четверо-п'ятеро — в ряд із легким перекриттям.
 * Колір і значок — за роллю учасника.
 */
export default function TeamAvatars({ members, size = 'md', className = '' }) {
  const layout = members.length === 3 ? 'triad' : 'row';
  return (
    <span className={`team-avatars team-avatars--${layout} team-avatars--${size} ${className}`} aria-hidden="true">
      {members.map((member) => (
        <span key={member.key} className="team-avatars__item" style={{ '--chip': member.color }}>
          <HugeiconsIcon icon={roleIcon(member.key)} size={size === 'sm' ? 12 : 15} strokeWidth={1.9} />
        </span>
      ))}
    </span>
  );
}

TeamAvatars.propTypes = {
  members: PropTypes.arrayOf(
    PropTypes.shape({ key: PropTypes.string.isRequired, color: PropTypes.string })
  ).isRequired,
  size: PropTypes.oneOf(['sm', 'md']),
  className: PropTypes.string,
};
