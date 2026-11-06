import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BubbleChatQuestionIcon,
  Cancel01Icon,
  ChattingIcon,
  CheckmarkBadge01Icon,
  Fire03Icon,
  Flag02Icon,
  FlashIcon,
  Route01Icon,
} from '@hugeicons/core-free-icons';
import { roleIcon } from '../../utils/debateOptions';
import { copy } from '../../copy';

const t = copy.tree;

export const personShape = PropTypes.shape({
  slug: PropTypes.string,
  name: PropTypes.string,
  color: PropTypes.string,
});

// значок статусу гілки: галочка, розвилка, хрестик — читається й без кольору
export const STATUS_ICONS = {
  chosen: CheckmarkBadge01Icon,
  alternative: Route01Icon,
  rejected: Cancel01Icon,
};

export const STAGE_ICONS = {
  question: BubbleChatQuestionIcon,
  debate: ChattingIcon,
  turn: FlashIcon,
  devil: Fire03Icon,
  conclusion: Flag02Icon,
};

/** Обрана гілка — перша, далі альтернативи, наприкінці відкинуті. */
export function orderBranches(branches) {
  const rank = { chosen: 0, alternative: 1, rejected: 2 };
  return [...(branches || [])].sort((a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1));
}

/** Кружечок учасника: колір з чату й іконка ролі, як аватар у дискусії. */
export function PersonDot({ person, colorOf, size = 26 }) {
  const color = colorOf(person);
  return (
    <span
      className="tree-person"
      style={{ '--person': color, '--size': `${size}px` }}
      title={person.name}
      aria-hidden="true"
    >
      <HugeiconsIcon icon={roleIcon(person.slug)} strokeWidth={1.8} />
    </span>
  );
}

PersonDot.propTypes = {
  person: personShape.isRequired,
  colorOf: PropTypes.func.isRequired,
  size: PropTypes.number,
};

/** Хто стояв за гілкою: кружечки внахльост; імена — для скрінрідера й у підказці. */
export function Supporters({ people, colorOf, max = 4 }) {
  if (!people?.length) return null;
  const shown = people.slice(0, max);
  const names = people.map((person) => person.name).join(', ');
  return (
    <span className="tree-supporters" title={`${t.supporters}: ${names}`}>
      {shown.map((person) => (
        <PersonDot key={person.name} person={person} colorOf={colorOf} size={24} />
      ))}
      {people.length > max && <span className="tree-supporters__more">+{people.length - max}</span>}
      <span className="sr-only">{`${t.supporters}: ${names}`}</span>
    </span>
  );
}

Supporters.propTypes = {
  people: PropTypes.arrayOf(personShape),
  colorOf: PropTypes.func.isRequired,
  max: PropTypes.number,
};

/** Наскільки шлях пасує людині: тонка шкала з відсотком. */
export function FitMeter({ value, compact = false }) {
  if (value === null || value === undefined) return null;
  return (
    <span className={`tree-fit ${compact ? 'tree-fit--compact' : ''}`} title={t.fit}>
      {/* у картці — коротко «пасує», щоб число не висіло без пояснення */}
      <span className="tree-fit__label">{compact ? t.fitShort : t.fit}</span>
      <span
        className="tree-fit__track"
        role="meter"
        aria-label={t.fit}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <span className="tree-fit__bar" style={{ '--fit': value / 100 }} />
      </span>
      <span className="tree-fit__value">{value}%</span>
    </span>
  );
}

FitMeter.propTypes = {
  value: PropTypes.number,
  compact: PropTypes.bool,
};

/** Кільце впевненості висновку з числом посередині. */
export function ConfidenceRing({ value, size = 52 }) {
  if (value === null || value === undefined) return null;
  const radius = 20;
  const length = 2 * Math.PI * radius;
  return (
    <span className="tree-ring" style={{ '--size': `${size}px` }} title={`${t.confidence}: ${value}%`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="tree-ring__track" cx="24" cy="24" r={radius} />
        <circle
          className="tree-ring__value"
          cx="24"
          cy="24"
          r={radius}
          strokeDasharray={length}
          strokeDashoffset={length * (1 - value / 100)}
        />
      </svg>
      <span className="tree-ring__number" aria-hidden="true">{value}</span>
      <span className="sr-only">{`${t.confidence}: ${value}%`}</span>
    </span>
  );
}

ConfidenceRing.propTypes = {
  value: PropTypes.number,
  size: PropTypes.number,
};
