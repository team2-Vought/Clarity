import { useLayoutEffect, useSyncExternalStore } from 'react';
import { readThemeMode } from '../utils/devicePrefs';

// Сторінки поза застосунком (лендинг, вхід, реєстрація) завжди в темі пристрою,
// а не в тій, що обрана в налаштуваннях застосунку.
const DARK_QUERY = '(prefers-color-scheme: dark)';

const subscribeScheme = (onChange) => {
  const query = window.matchMedia?.(DARK_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
};

const systemPrefersDark = () => Boolean(window.matchMedia?.(DARK_QUERY).matches);

const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#121212' : '#ececec';
};

export function useDeviceTheme() {
  const systemDark = useSyncExternalStore(subscribeScheme, systemPrefersDark);

  // до першого кадру, щоб при переході з застосунку тема не блимнула
  useLayoutEffect(() => {
    applyTheme(systemDark ? 'dark' : 'light');
  }, [systemDark]);

  // поза цими сторінками повертаємо тему, збережену в налаштуваннях застосунку;
  // теж layout-ефект: його прибирання йде раніше, ніж наступна сторінка (вхід після
  // лендингу) поставить свою тему, тож тема пристрою не перезапишеться збереженою
  useLayoutEffect(
    () => () => {
      const mode = readThemeMode();
      if (mode !== 'system') applyTheme(mode);
    },
    []
  );

  return systemDark ? 'dark' : 'light';
}
