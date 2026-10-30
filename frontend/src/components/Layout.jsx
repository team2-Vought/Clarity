import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { MenuIcon } from './DebateIcons';
import { UNAUTHORIZED_EVENT } from '../api/client';
import { useToasts } from '../hooks/useToasts';
import { copy } from '../copy';
import { refreshJournalDue } from '../hooks/useJournalDue';
import { readThemeMode, writeThemeMode } from '../utils/devicePrefs';
import { morphSidebar } from '../utils/sidebarMorph';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const subscribeScheme = (onChange) => {
  const query = window.matchMedia?.(DARK_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
};

const systemPrefersDark = () => Boolean(window.matchMedia?.(DARK_QUERY).matches);

export default function Layout() {
  const [collapsed, setCollapsed] = useState(true);
  // 'light' | 'dark' | 'system': «як у системі» стежить за налаштуванням ОС наживо
  const [themeMode, setThemeMode] = useState(readThemeMode);
  const systemDark = useSyncExternalStore(subscribeScheme, systemPrefersDark);
  const theme = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { pushToast } = useToasts();

  // рішення, що чекають на «Як воно?», могли з'явитися, поки людина була деінде
  useEffect(() => {
    refreshJournalDue();
  }, [pathname]);

  // прострочена сесія з будь-якого запиту веде на вхід, а не лишає сторінку з помилкою
  useEffect(() => {
    const handleUnauthorized = () => {
      pushToast(copy.common.sessionExpired);
      navigate('/login', { replace: true });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [navigate, pushToast]);

  // Сайдбар після переходу на іншу сторінку меню завжди згортається
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setCollapsed(true);
  }

  // смуги браузера на телефоні — того ж кольору, що й сторінка застосунку;
  // поза ним (лендинг, вхід) повертаємо колір їхнього сірого тла
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return undefined;
    meta.content = theme === 'dark' ? '#121212' : '#ffffff';
    return () => {
      meta.content = document.documentElement.dataset.theme === 'dark' ? '#121212' : '#ececec';
    };
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    writeThemeMode(themeMode);
  }, [themeMode]);

  // Панель налаштувань дебату ховається кнопкою в куті області чату
  // (і повторним кліком на «Новий чат» на головній).
  // Стан живе тут, тож не губиться при переході між головною й чатом.
  // На телефоні панель висувна — її відкриває сама сторінка.
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const phonePanelToggleRef = useRef(null);

  const registerPanelToggle = useCallback((fn) => {
    phonePanelToggleRef.current = fn;
    return () => {
      if (phonePanelToggleRef.current === fn) phonePanelToggleRef.current = null;
    };
  }, []);

  const togglePanel = useCallback(() => {
    const isPhone = window.matchMedia?.('(max-width: 639px)').matches;
    if (isPhone) {
      if (!phonePanelToggleRef.current) return false;
      phonePanelToggleRef.current();
    } else {
      setPanelCollapsed((current) => !current);
    }
    setCollapsed(true);
    return true;
  }, []);

  const outletContext = useMemo(
    () => ({ panelCollapsed, registerPanelToggle, togglePanel, themeMode, setThemeMode }),
    [panelCollapsed, registerPanelToggle, togglePanel, themeMode]
  );

  // іконки перетікають між смугою й карткою меню, а не зникають; рух
  // запускається до першого кадру, тож картка одразу стартує з іконками смуги
  const railRef = useRef(null);
  const drawerRef = useRef(null);
  const morphRef = useRef([]);
  const burgerRef = useRef(null);
  const morphedCollapsedRef = useRef(collapsed);
  useLayoutEffect(() => {
    if (morphedCollapsedRef.current === collapsed) return;
    morphedCollapsedRef.current = collapsed;
    morphSidebar(railRef.current, drawerRef.current, !collapsed, morphRef, burgerRef.current);
  }, [collapsed]);

  // Escape закриває розгорнуте меню
  useEffect(() => {
    if (collapsed) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') setCollapsed(true);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [collapsed]);

  const toggle = () => setCollapsed((c) => !c);
  const toggleTheme = () => setThemeMode(theme === 'dark' ? 'light' : 'dark');

  return (
    <div className="app-shell">
      {/* поки меню відкрите, смуги іконок немає — вона ніби стала карткою меню */}
      <div
        ref={railRef}
        className={`app-shell__rail ${collapsed ? '' : 'app-shell__rail--lifted'}`}
        inert={!collapsed}
      >
        <Sidebar
          variant="rail"
          activePath={pathname}
          collapsed
          onToggle={toggle}
          theme={theme}
          onToggleTheme={toggleTheme}
          onTogglePanel={togglePanel}
        />
      </div>

      {/* обгортка несе тінь картки: clip-path самого меню обрізав би її */}
      <div
        ref={drawerRef}
        className={`app-shell__drawer ${collapsed ? '' : 'app-shell__drawer--open'}`}
      >
        <Sidebar
          variant="drawer"
          activePath={pathname}
          collapsed={collapsed}
          onToggle={toggle}
          theme={theme}
          onToggleTheme={toggleTheme}
          onTogglePanel={togglePanel}
        />
      </div>

      {/* на телефоні смуги іконок немає — меню відкривається цією кнопкою */}
      <button
        ref={burgerRef}
        type="button"
        className="app-shell__burger"
        onClick={toggle}
        aria-label={copy.nav.menu}
        aria-expanded={!collapsed}
      >
        <MenuIcon />
      </button>

      {/* затемнення завжди в розмітці, тож проявляється й зникає плавно */}
      <div
        className={`app-shell__backdrop ${collapsed ? '' : 'app-shell__backdrop--visible'}`}
        onClick={() => setCollapsed(true)}
        aria-hidden="true"
      />

      <main className="app-shell__main">
        <Outlet context={outletContext} />
      </main>
    </div>
  );
}