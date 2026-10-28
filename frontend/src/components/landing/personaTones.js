// Пастельні кольори ролей на лендингу — ті самі, що й у складі команди в застосунку
export const PERSONA_TONES = {
  logician: '#f4c1cf',
  emotional: '#feedd5',
  skeptic: '#c2effd',
  pragmatist: '#d3f0dc',
  creative: '#e4d4f4',
  moderator: '#fff1b8',
  devil: '#ef4444',
};

export const toneOf = (slug) => PERSONA_TONES[slug] || '#b4b5ce';

/** Чи просить користувач менше руху: система або «Менше анімації» в налаштуваннях */
export const prefersReducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced' ||
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
