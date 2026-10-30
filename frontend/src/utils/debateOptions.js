import {
  BrainIcon,
  BulbIcon,
  FavouriteIcon,
  Fire03Icon,
  JusticeScale01Icon,
  Search01Icon,
  UserIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons';
import { copy } from '../copy';

// риси мовою інтерфейсу; сервер знає інструкції до них обома мовами
export const TRAITS = copy.debate.traits;

export const TRAIT_COLORS = [
  '#f4c1cf', '#feedd5', '#c2effd', '#b4b5ce', '#d3f0dc', '#fff1b8',
  '#e4d4f4', '#ffd9c7', '#cfe3fb', '#f6d5ea', '#d9ecc6', '#ffe0b8',
];

// Порядок ролей за замовчуванням: уже двоє учасників дають різні погляди
// (аналітичний і людський), далі — критика, практичність, нестандартність.
export const ROLE_ORDER = ['logician', 'emotional', 'skeptic', 'pragmatist', 'creative'];

// Іконка ролі — «обличчя» учасника: у складі команди й аватар у дискусії
const ROLE_ICONS = {
  logician: BrainIcon,
  emotional: FavouriteIcon,
  skeptic: Search01Icon,
  pragmatist: Wrench01Icon,
  creative: BulbIcon,
  moderator: JusticeScale01Icon,
  devil: Fire03Icon,
  research: Search01Icon,
};

export const roleIcon = (slug) => ROLE_ICONS[slug] || UserIcon;
