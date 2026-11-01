// Тема й «Менше анімації» — до першого кадру, щоб нічого не блимнуло й не поїхало.
// Окремий файл, а не вбудований скрипт: так CSP може заборонити будь-який inline-JavaScript.
(() => {
  try {
    const saved = localStorage.getItem('clarity-theme');
    const theme = saved === 'light' || saved === 'dark'
      ? saved
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    if (theme === 'dark') {
      document.querySelector('meta[name="theme-color"]').content = '#121212';
    }
    if (localStorage.getItem('clarity:motion') === 'reduced') {
      document.documentElement.dataset.motion = 'reduced';
    }
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
