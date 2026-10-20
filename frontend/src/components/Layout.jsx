import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  const [collapsed, setCollapsed] = useState(true);
  const { pathname } = useLocation();

  // після переходу на іншу сторінку меню завжди згортається
  useEffect(() => {
    setCollapsed(true);
  }, [pathname]);

  const toggle = () => setCollapsed((c) => !c);

  return (
    <div className="app-shell">
      {/* верхня панель — лише на мобільних */}
      <header className="app-shell__topbar">
        <button
          type="button"
          className="app-shell__burger"
          onClick={toggle}
          aria-label="Меню"
          aria-expanded={!collapsed}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="app-shell__rail">
        <Sidebar activePath={pathname} collapsed={collapsed} onToggle={toggle} />
      </div>

      {!collapsed && <div className="app-shell__backdrop" onClick={() => setCollapsed(true)} aria-hidden="true" />}

      <main className="app-shell__main">
        <Outlet />
      </main>
    </div>
  );
}