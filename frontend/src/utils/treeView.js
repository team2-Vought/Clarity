import { describeVerdict } from './summary';
import { DEVIL_COLOR, MODERATOR_COLOR } from './chatView';
import { copy } from '../copy';

const FALLBACK_COLOR = '#e4e4ea';

/**
 * Коротка відповідь висновку для кореня дерева: «Так» / «Ні» мовою інтерфейсу
 * чи обраний варіант. У вільному режимі відповідь — ціле рішення, тож порожньо.
 */
export function stanceLabelOf(answer, mode) {
  if (!answer || mode === 'open') return '';
  const verdict = describeVerdict({ answer }, mode, []);
  if (verdict.kind === 'yes_no') return verdict.yes ? copy.chat.summaryYes : copy.chat.summaryNo;
  return String(answer);
}

/** Колір учасника на схемі — той самий, що в його бульбашках у чаті. */
export function treeColorOf(participantColors) {
  return (person) => {
    if (person?.slug === 'devil') return DEVIL_COLOR;
    if (person?.slug === 'moderator') return MODERATOR_COLOR;
    return participantColors?.get(person?.slug) || FALLBACK_COLOR;
  };
}
