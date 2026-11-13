import { ROLE_COLORS, roleColor } from '../../utils/debateOptions';

// Пастельні кольори ролей на лендингу — одне джерело з меню складів у застосунку
export const PERSONA_TONES = ROLE_COLORS;

export const toneOf = (slug) => roleColor(slug, '#b4b5ce');

/** Чи просить користувач менше руху: система або «Менше анімації» в налаштуваннях */
export const prefersReducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced' ||
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
