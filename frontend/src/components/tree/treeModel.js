import PropTypes from 'prop-types';
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

// Дані дерева рішень, спільні для його компонентів (parts.jsx лишає лише компоненти)

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

