import { useEffect, useState } from 'react';
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
        />
      </div>

      {!collapsed && <div className="app-shell__backdrop" onClick={() => setCollapsed(true)} aria-hidden="true" />}

      <main className="app-shell__main">
        <Outlet />
      </main>
    </div>
  );
}