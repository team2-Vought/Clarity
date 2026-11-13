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

// Колір ролі — той самий, що на лендингу: роль впізнається за кольором,
// хоч би на якому місці в складі вона стояла (меню готових складів)
export const ROLE_COLORS = {
  logician: '#f4c1cf',
  emotional: '#feedd5',
  skeptic: '#c2effd',
  pragmatist: '#d3f0dc',
  creative: '#e4d4f4',
  moderator: '#fff1b8',
  devil: '#ef4444',
};

export const roleColor = (slug, fallback = TRAIT_COLORS[0]) => ROLE_COLORS[slug] || fallback;

// свої ролі людини («Юрист», «Тато») — кольорами, яких немає у вбудованих ролей
const CUSTOM_ROLE_COLORS = ['#b4b5ce', '#ffd9c7', '#cfe3fb', '#f6d5ea', '#d9ecc6', '#ffe0b8'];

/**
 * Колір учасника скрізь у застосунку: склад, чат, публічне посилання, меню складів.
 * Вбудована роль — завжди свій колір (як на лендингу); своя роль — за місцем у складі.
 */
export const participantColor = (slug, index = 0) =>
  ROLE_COLORS[slug] || CUSTOM_ROLE_COLORS[index % CUSTOM_ROLE_COLORS.length];

/**
 * Готові склади команди: людині не треба знати ролі, щоб зібрати корисну команду.
 * Слаги — вбудовані ролі (backend/discussions/personas.py). Перший — «Збалансована» —
 * склад нової дискусії за замовчуванням.
 */
export const TEAM_PRESETS = [
  { key: 'balanced', slugs: ['logician', 'emotional', 'skeptic'] },
  { key: 'money', slugs: ['logician', 'pragmatist', 'skeptic'] },
  { key: 'people', slugs: ['emotional', 'pragmatist', 'creative'] },
  { key: 'ideas', slugs: ['creative', 'pragmatist', 'skeptic'] },
];

/** Учасник дискусії з сервера: старі дискусії зберігали роль просто рядком. */
export const asPersona = (persona) => (typeof persona === 'string' ? { slug: persona } : persona || {});
