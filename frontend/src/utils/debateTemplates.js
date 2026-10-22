import {
  Briefcase01Icon,
  BulbIcon,
  CheckListIcon,
  FavouriteIcon,
  MortarboardIcon,
  ShoppingBag01Icon,
} from '@hugeicons/core-free-icons';

// Готові сценарії для стартової сторінки: формат відповіді, склад ролей,
// раунди й пошук. Тексти (назва, заготовка питання) — у copy/uk.js.
export const DEBATE_TEMPLATES = [
  { id: 'buy', icon: ShoppingBag01Icon, mode: 'yes_no', roles: ['pragmatist', 'skeptic', 'emotional'], rounds: 2, webSearch: true },
  { id: 'career', icon: Briefcase01Icon, mode: 'yes_no', roles: ['pragmatist', 'emotional', 'skeptic', 'logician'], rounds: 2, webSearch: true },
  { id: 'choice', icon: CheckListIcon, mode: 'choose_one', roles: ['logician', 'pragmatist', 'creative'], rounds: 2, webSearch: true },
  { id: 'business', icon: BulbIcon, mode: 'open', roles: ['pragmatist', 'skeptic', 'creative', 'logician'], rounds: 3, webSearch: true },
  { id: 'personal', icon: FavouriteIcon, mode: 'open', roles: ['emotional', 'logician', 'creative'], rounds: 2, webSearch: false },
  { id: 'learning', icon: MortarboardIcon, mode: 'open', roles: ['pragmatist', 'logician', 'creative'], rounds: 2, webSearch: true },
];
