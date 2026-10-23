import { uk } from '../copy/uk';
import { TRAIT_COLORS } from './debateOptions';

// Спільне для чату й публічного посилання: кольори, підписи етапів і позицій.

const t = uk.chat;

export const DEVIL_COLOR = '#e5484d';
export const MODERATOR_COLOR = '#fde3c6';
export const USER_COLOR = '#f0f0f0';
export const RESEARCH_COLOR = '#d6eefb';

// «погоджується · Логік» замість голого «погоджується»: видно, з ким саме.
// У режимах з вибором позиція — це сама відповідь, а не згода з кимось.
export const stanceLabel = (message, mode, replyName) => {
  const { stance } = message;
  if (!stance) return '';
  if (mode && mode !== 'open') return t.stanceAnswer(stance);
  if (message.phase === 'rebuttal') return t.stanceDecision[stance] || stance;
  const verb = t.stance[stance] || stance;
  return replyName ? `${verb} · ${replyName}` : verb;
};

export const stanceTone = (stance) =>
  stance === 'згода' ? 'agree' : stance === 'суперечка' ? 'disagree' : 'neutral';

export const speakerKeyOf = (message) =>
  message.role === 'user' ? 'user' : message.persona_name || message.role;

export const slugOf = (message) => (message.role === 'user' ? 'user' : message.persona_slug);

// Остання репліка модератора у фазі «Фінальний висновок» дослівно повторює
// картку підсумку під чатом. Поки картка видна, цю репліку не показуємо.
export const duplicateFinalId = (messages, summaryShown) => {
  if (!summaryShown) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'moderator' && message.phase === 'final') return message.id;
  }
  return null;
};

// Остання репліка того, кому відповідають, — для цитати над текстом
export const findReplyTarget = (messages, index) => {
  const message = messages[index];
  if (!message.reply_to && !message.reply_to_slug) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (message.reply_to_slug ? slugOf(candidate) === message.reply_to_slug
      : candidate.persona_name === message.reply_to) {
      return candidate;
    }
  }
  return null;
};

export const phaseLabel = (message) => {
  switch (message.phase) {
    case 'research':
      return t.phaseResearch;
    case 'opening':
      return t.phaseOpening;
    case 'debate':
      return t.phaseRound(message.round || 1);
    case 'synthesis':
      return t.phaseSynthesis;
    case 'devil':
      return t.phaseDevil;
    case 'rebuttal':
      return t.phaseRebuttal;
    case 'final':
      return t.phaseFinal;
    default:
      return '';
  }
};

// Колір і бік бульбашки кожного автора: учасники чергуються ліворуч і праворуч
export const buildSpeakers = (messages, participantColors) => {
  const map = new Map();
  let index = 0;
  (messages || []).forEach((message) => {
    const key = speakerKeyOf(message);
    if (map.has(key)) return;
    if (message.role === 'devil') {
      map.set(key, { color: DEVIL_COLOR, side: 'right' });
    } else if (message.role === 'moderator') {
      map.set(key, { color: MODERATOR_COLOR, side: 'left' });
    } else if (message.role === 'research') {
      map.set(key, { color: RESEARCH_COLOR, side: 'left' });
    } else if (message.role === 'user') {
      map.set(key, { color: USER_COLOR, side: 'right' });
    } else {
      map.set(key, {
        color: participantColors.get(message.persona_slug) || TRAIT_COLORS[index % TRAIT_COLORS.length],
        side: index % 2 === 0 ? 'left' : 'right',
      });
      index += 1;
    }
  });
  return map;
};
