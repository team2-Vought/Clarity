import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  const [collapsed, setCollapsed] = useState(true);
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  );
  const { pathname } = useLocation();

  // Сайдбар після переходу на іншу сторінку меню завжди згортається
  useEffect(() => {
    setCollapsed(true);
  }, [pathname]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('clarity-theme', theme);
    } catch {}
  }, [theme]);

  // Панель налаштувань дебату ховається повторним кліком на «Дебати».
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

  const togglePanel = () => {
    const isPhone = window.matchMedia?.('(max-width: 639px)').matches;
    if (isPhone) {
      if (!phonePanelToggleRef.current) return false;
      phonePanelToggleRef.current();
    } else {
      setPanelCollapsed((current) => !current);
    }
    setCollapsed(true);
    return true;
  };

  const outletContext = useMemo(
    () => ({ panelCollapsed, registerPanelToggle }),
    [panelCollapsed, registerPanelToggle]
  );

  const toggle = () => setCollapsed((c) => !c);
  const toggleTheme = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'));

  return (
    <div className="app-shell">
      <div className="app-shell__rail">
        <Sidebar
          activePath={pathname}
          collapsed={collapsed}
          onToggle={toggle}
          theme={theme}
          onToggleTheme={toggleTheme}
          onTogglePanel={togglePanel}
        />
      </div>

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