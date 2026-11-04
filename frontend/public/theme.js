// Тема, «Менше анімації» й режим для слабозорих — до першого кадру, щоб нічого не блимнуло й не поїхало.
// Окремий файл, а не вбудований скрипт: так CSP може заборонити будь-який inline-JavaScript.
(() => {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem('clarity-theme');
    const theme = saved === 'light' || saved === 'dark'
      ? saved
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    if (theme === 'dark') {
      document.querySelector('meta[name="theme-color"]').content = '#121212';
    }
    if (localStorage.getItem('clarity:motion') === 'reduced') {
      root.dataset.motion = 'reduced';
    }
  } catch {
    root.dataset.theme = 'light';
  }

  // режим для слабозорих: ті самі атрибути, що ставить src/utils/vision.js
  try {
    let vision = {};
    try {
      vision = JSON.parse(localStorage.getItem('clarity:vision') || '{}') || {};
    } catch {
      vision = {};
    }
    if ([125, 150, 175].includes(vision.scale)) root.dataset.textScale = String(vision.scale);
    const contrast = vision.contrast === 'high' || vision.contrast === 'normal'
      ? vision.contrast
      : (window.matchMedia('(prefers-contrast: more)').matches ? 'high' : 'normal');
    if (contrast === 'high') root.dataset.contrast = 'high';
    if (vision.font === 'readable') root.dataset.font = 'readable';
    if (vision.spacing === true) root.dataset.spacing = 'wide';
    if (vision.links === true) root.dataset.links = 'underline';
    if (vision.focus === true) root.dataset.focus = 'strong';
    if (vision.cursor === true) root.dataset.cursor = 'large';
  } catch {
    // без сховища — звичайний вигляд
  }
})();
