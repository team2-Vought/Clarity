import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import Logo from './Logo';
import { logout } from '../api/auth';
import { copy } from '../copy';
import { useNotifyPrefs } from '../hooks/useNotifyPrefs';
import { useJournalDue } from '../hooks/useJournalDue';
import { openVisionPanel } from '../utils/vision';
import { openBugReport } from '../utils/bugReport';

const t = copy.nav;

const DebateIcon = () => (
  <svg width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
    <path d="M25.6172 10.1978C27.4424 12.0231 25.456 16.9687 21.1805 21.2442C16.905 25.5197 11.9594 27.506 10.1342 25.6808C8.30898 23.8556 10.2953 18.91 14.5708 14.6345C18.8463 10.359 23.792 8.37262 25.6172 10.1978Z" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" />
    <path d="M21.1805 14.6347C25.456 18.9102 27.4424 23.8559 25.6172 25.6811C23.792 27.5063 18.8463 25.5199 14.5708 21.2444C10.2953 16.9689 8.30898 12.0233 10.1342 10.1981C11.9594 8.37286 16.905 10.3592 21.1805 14.6347Z" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" />
  </svg>
);

const HistoryIcon = () => (
  <svg width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
    <path d="M8.44055 13.552C8.75 12.8157 9.15548 12.1221 9.63566 11.4819C11.3857 9.177 14.16 7.68311 17.2865 7.68311C22.5899 7.68311 26.8902 11.9834 26.8902 17.2867C26.8902 22.5901 22.5899 26.8903 17.2865 26.8903C12.6448 26.8903 8.78201 23.6038 7.875 19.2288" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" />
    <path d="M14.5122 20.061L17.2866 17.3826V12.1113" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M11.8764 14.1813H7.68286V9.46484" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
    <path d="M15.1891 8.4156L14.0829 10.3334C13.8151 10.7978 13.3197 11.0839 12.7836 11.0839H10.5718C10.0361 11.0839 9.54106 11.3697 9.27305 11.8335L8.4747 13.2153C8.20663 13.6792 8.20642 14.251 8.47414 14.7151L9.58119 16.6345C9.84871 17.0983 9.84871 17.6696 9.58119 18.1334L8.47497 20.0513C8.20681 20.5162 8.20789 21.0893 8.47634 21.554C8.77188 22.0657 8.97718 22.4236 9.27309 22.9358C9.54059 23.399 10.0353 23.6839 10.5702 23.6839H12.7852C13.3205 23.6839 13.8152 23.9692 14.0834 24.4324L15.1887 26.3416C15.4569 26.8048 15.9516 27.09 16.4868 27.09H18.0848C18.6209 27.09 19.1163 26.8039 19.3842 26.3395L20.4903 24.4217C20.7582 23.9573 21.2535 23.6711 21.7897 23.6711H24.0014C24.5371 23.6711 25.0322 23.3854 25.3002 22.9216L26.0985 21.5398C26.3666 21.0758 26.3668 20.5041 26.0991 20.0399L24.9921 18.1206C24.7245 17.6568 24.7245 17.0855 24.9921 16.6217L26.0983 14.7038C26.3664 14.2388 26.3654 13.6658 26.0969 13.201C25.8014 12.6894 25.5961 12.3315 25.3002 11.8192C25.0327 11.3561 24.5379 11.0711 24.0031 11.0711H21.788C21.2528 11.0711 20.7581 10.7859 20.4899 10.3227L19.3846 8.41348C19.1164 7.95026 18.6217 7.66504 18.0864 7.66504H16.4884C15.9523 7.66504 15.457 7.95118 15.1891 8.4156Z" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="round" />
    <path d="M20.2445 17.3725C20.2445 19.0061 18.9202 20.3304 17.2865 20.3304C15.6529 20.3304 14.3286 19.0061 14.3286 17.3725C14.3286 15.7389 15.6529 14.4146 17.2865 14.4146C18.9202 14.4146 20.2445 15.7389 20.2445 17.3725Z" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="round" />
  </svg>
);

const HelpIcon = () => (
  <svg width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
    <path d="M17.0732 9.60384C21.6574 9.60384 25.3964 13.3429 25.3964 17.927C25.3964 22.5112 21.6574 26.2502 17.0732 26.2502C12.4891 26.2502 8.75008 22.5112 8.75008 17.927C8.75008 13.3429 12.4891 9.60384 17.0732 9.60384ZM17.0732 7.68311C11.4135 7.68311 6.82935 12.2673 6.82935 17.927C6.82935 23.5868 11.4135 28.1709 17.0732 28.1709C22.733 28.1709 27.3172 23.5868 27.3172 17.927C27.3172 12.2673 22.733 7.68311 17.0732 7.68311Z" fill="currentColor" />
    <path d="M17.073 17.6709V22.0246" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" />
    <path d="M17.073 15.2763C17.7802 15.2763 18.3535 14.703 18.3535 13.9958C18.3535 13.2886 17.7802 12.7153 17.073 12.7153C16.3658 12.7153 15.7925 13.2886 15.7925 13.9958C15.7925 14.703 16.3658 15.2763 17.073 15.2763Z" fill="currentColor" />
  </svg>
);

const ThemeIcon = () => (
  <svg width="35" height="35" viewBox="0 0 25 25" fill="none" aria-hidden="true">
    <path d="M12.4999 3.12516V2.0835M12.4999 22.9168V21.8752M21.8749 12.5002H22.9166M2.08325 12.5002H3.12492M19.2708 5.72933L20.8333 4.16683M4.16659 20.8335L5.72909 19.271M4.16659 4.16683L5.72909 5.72933M19.2708 19.271L20.8333 20.8335" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M16.6666 12.5002C16.6666 14.8013 14.8011 16.6668 12.4999 16.6668C10.1987 16.6668 8.33325 14.8013 8.33325 12.5002C8.33325 10.199 10.1987 8.3335 12.4999 8.3335C14.8011 8.3335 16.6666 10.199 16.6666 12.5002Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// око — режим для людей із порушеннями зору
const VisionIcon = () => (
  <svg width="35" height="35" viewBox="0 0 25 25" fill="none" aria-hidden="true">
    <path d="M2.6 12.5C4.4 8.3 8.1 5.7 12.5 5.7s8.1 2.6 9.9 6.8c-1.8 4.2-5.5 6.8-9.9 6.8s-8.1-2.6-9.9-6.8Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M15.6 12.5a3.1 3.1 0 1 1-6.2 0 3.1 3.1 0 0 1 6.2 0Z" stroke="currentColor" strokeWidth="2" />
  </svg>
);

// жучок — «Знайшли баги?»
const BugIcon = () => (
  <svg width="35" height="35" viewBox="0 0 25 25" fill="none" aria-hidden="true">
    <path d="M8.3 9.4h8.4v5.2a4.2 4.2 0 0 1-8.4 0V9.4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M9.6 9.4V8.2a2.9 2.9 0 0 1 5.8 0v1.2M12.5 13v5.7M8.3 13H4.6m15.8 0h-3.7M8.6 10.6 5.6 8.5m13.8 0-3 2.1M8.6 16.5l-3 2.2m13.8 0-3-2.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const MoonIcon = () => (
  <svg width="35" height="35" viewBox="0 0 25 25" fill="none" aria-hidden="true">
    <path
      d="M20.5 14.4A8.5 8.5 0 0 1 10.6 4.5 8.5 8.5 0 1 0 20.5 14.4Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const VolumeIcon = () => (
  <svg width="35" height="35" viewBox="0 0 25 25" fill="none" aria-hidden="true">
    <path d="M17.1943 8.7085C17.861 9.75016 18.236 10.9863 18.236 12.3057C18.236 13.6252 17.861 14.8613 17.1943 15.9029" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" />
    <path d="M21.7361 7.25C22.4861 8.77778 22.9028 10.4861 22.9028 12.3056C22.9028 14.125 22.4861 15.8333 21.7361 17.3611" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12.4999 4.99983V19.9998C12.4999 21.2498 10.9999 21.9026 10.0833 21.0415L7.13883 18.2637C6.87495 18.0276 6.54161 17.8887 6.1805 17.8887H4.1805C3.04161 17.8887 2.09717 16.9582 2.09717 15.8054V9.19427C2.09717 8.0415 3.02772 7.11094 4.1805 7.11094H6.1805C6.52772 7.11094 6.87495 6.97205 7.13883 6.73594L10.0833 3.95816C10.9999 3.09705 12.4999 3.74983 12.4999 4.99983Z" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" />
  </svg>
);

// той самий динамік, але замість хвиль — хрестик
const VolumeOffIcon = () => (
  <svg width="35" height="35" viewBox="0 0 25 25" fill="none" aria-hidden="true">
    <path d="M17.2 9.6L22.2 14.6M22.2 9.6L17.2 14.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M12.4999 4.99983V19.9998C12.4999 21.2498 10.9999 21.9026 10.0833 21.0415L7.13883 18.2637C6.87495 18.0276 6.54161 17.8887 6.1805 17.8887H4.1805C3.04161 17.8887 2.09717 16.9582 2.09717 15.8054V9.19427C2.09717 8.0415 3.02772 7.11094 4.1805 7.11094H6.1805C6.52772 7.11094 6.87495 6.97205 7.13883 6.73594L10.0833 3.95816C10.9999 3.09705 12.4999 3.74983 12.4999 4.99983Z" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="35" height="35" viewBox="0 0 25 25" fill="none" aria-hidden="true">
    <path d="M11.5126 4.0625H7.2876C6.18303 4.0625 5.2876 4.95793 5.2876 6.0625V18.9375C5.2876 20.0421 6.18303 20.9375 7.2876 20.9375H11.5126" stroke="#FF8787" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M11.8 12.5001H20.1501L16.5 8.8501L20.1501 12.5001L16.5 16.1501" stroke="#FF8787" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// розгорнута книжка — журнал рішень; та сама сітка 35×35 і штрих 2, що й в інших іконок меню
const JournalIcon = () => (
  <svg width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
    <path d="M17.5 11.4C15.3 9.7 12.3 9.1 8.3 9.4V24.2C12.3 23.9 15.3 24.5 17.5 26.2C19.7 24.5 22.7 23.9 26.7 24.2V9.4C22.7 9.1 19.7 9.7 17.5 11.4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M17.5 11.4V26.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const ICONS = {
  debates: DebateIcon,
  history: HistoryIcon,
  journal: JournalIcon,
  settings: SettingsIcon,
  help: HelpIcon,
};

// «Новий чат» підсвічений лише на стартовій сторінці: з відкритої дискусії
// клік веде до нового чату, а не ховає панель налаштувань.
const NAV_ITEMS = [
  { key: 'debates', label: t.debates, path: '/home', match: ['/home'] },
  { key: 'history', label: t.history, path: '/history', match: ['/history'] },
  { key: 'journal', label: t.journal, path: '/journal', match: ['/journal'] },
  { key: 'settings', label: t.settings, path: '/settings', match: ['/settings'] },
  { key: 'help', label: t.help, path: '/help', match: ['/help'] },
];

const isItemActive = (item, pathname) =>
  (item.match || []).some((p) => pathname === p || pathname.startsWith(`${p}/`));

// Смуга іконок (`rail`) стоїть зліва на ширших екранах і завжди згорнута;
// розгорнуте меню (`drawer`) — окреме вікно, що виїжджає поверх неї
// і на ПК, і на телефоні.
export default function Sidebar({
  variant = 'rail',
  activePath,
  collapsed,
  onToggle,
  theme,
  onToggleTheme,
  onTogglePanel,
}) {
  const { sound, setSound } = useNotifyPrefs();
  // рішення, що чекають на «Як воно?», — число на іконці журналу
  const { count: dueCount } = useJournalDue();
  const navigate = useNavigate();
  const themeActionLabel = theme === 'dark' ? t.themeLight : t.themeDark;

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/', { replace: true });
    }
  };

  return (
    <aside
      className={`sidebar sidebar--${variant} ${collapsed ? 'sidebar--collapsed' : ''}`}
      aria-label={t.appName}
    >
      <div
        className="sidebar__brand"
        role="button"
        tabIndex={0}
        aria-label={t.menu}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <Logo onHome={() => {}} />
        <span className="sidebar__brand-label">{t.appName}</span>
      </div>

      <nav className="sidebar__nav" aria-label={t.mainNav}>
        {NAV_ITEMS.map((item, index) => {
          const active = isItemActive(item, activePath);
          const Icon = ICONS[item.key];
          return (
            <button
              key={item.key}
              type="button"
              className={`sidebar__item ${active ? 'sidebar__item--active' : ''}`}
              style={{ '--i': index }}
              title={
                item.key === 'debates' && active
                  ? t.togglePanel
                  : collapsed
                    ? item.label
                    : undefined
              }
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                // повторний клік на активний «Новий чат» ховає / показує панель налаштувань
                if (item.key === 'debates' && active && onTogglePanel?.()) return;
                navigate(item.path);
              }}
            >
              <Icon />
              <span className="sidebar__label">{item.label}</span>
              {item.key === 'journal' && dueCount > 0 && (
                <span className="sidebar__badge" title={copy.journal.dueBadge(dueCount)}>
                  {dueCount}
                  <span className="sr-only">{copy.journal.dueBadge(dueCount)}</span>
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar__controls">
        <button
          type="button"
          className="sidebar__control"
          style={{ '--i': NAV_ITEMS.length }}
          onClick={onToggleTheme}
          aria-label={themeActionLabel}
          title={collapsed ? themeActionLabel : undefined}
        >
          {theme === 'dark' ? <ThemeIcon /> : <MoonIcon />}
          <span className="sidebar__label">{themeActionLabel}</span>
        </button>
        <button
          type="button"
          className="sidebar__control"
          style={{ '--i': NAV_ITEMS.length + 1 }}
          onClick={openVisionPanel}
          aria-haspopup="dialog"
          aria-label={copy.vision.triggerAria}
          title={collapsed ? copy.vision.triggerAria : undefined}
        >
          <VisionIcon />
          <span className="sidebar__label">{copy.vision.trigger}</span>
        </button>
        {/* звук, яким Clarity кличе назад, коли висновок готовий */}
        <button
          type="button"
          className={`sidebar__control ${sound ? '' : 'sidebar__control--off'}`}
          style={{ '--i': NAV_ITEMS.length + 2 }}
          onClick={() => setSound(!sound)}
          aria-pressed={sound}
          aria-label={t.sound}
          title={sound ? t.soundOn : t.soundOff}
        >
          {sound ? <VolumeIcon /> : <VolumeOffIcon />}
          <span className="sidebar__label">{t.sound}</span>
        </button>
        <button
          type="button"
          className="sidebar__control"
          style={{ '--i': NAV_ITEMS.length + 3 }}
          onClick={() => openBugReport()}
          aria-haspopup="dialog"
          aria-label={copy.report.triggerAria}
          title={collapsed ? copy.report.trigger : undefined}
        >
          <BugIcon />
          <span className="sidebar__label">{copy.report.trigger}</span>
        </button>
        <button
          type="button"
          className="sidebar__control sidebar__control--logout"
          style={{ '--i': NAV_ITEMS.length + 4 }}
          onClick={handleLogout}
          aria-label={t.logout}
          title={collapsed ? t.logout : undefined}
        >
          <LogoutIcon />
          <span className="sidebar__label">{t.logout}</span>
        </button>
      </div>
    </aside>
  );
}

Sidebar.propTypes = {
  variant: PropTypes.oneOf(['rail', 'drawer']),
  activePath: PropTypes.string.isRequired,
  collapsed: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  theme: PropTypes.oneOf(['light', 'dark']).isRequired,
  onToggleTheme: PropTypes.func.isRequired,
  onTogglePanel: PropTypes.func,
};