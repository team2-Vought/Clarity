import {
  Alert02Icon,
  HelpCircleIcon,
  IdeaIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from '@hugeicons/core-free-icons';

// іконка кожної реакції — та сама в меню, на позначці під реплікою й у «Моїх позначках»
export const REACTION_ICONS = {
  convincing: ThumbsUpIcon,
  unconvincing: ThumbsDownIcon,
  insight: IdeaIcon,
  unclear: HelpCircleIcon,
  wrong: Alert02Icon,
};
