import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Cancel01Icon,
  Delete02Icon,
  GridViewIcon,
  ListViewIcon,
  PencilEdit02Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { deleteDiscussion, fetchDiscussions } from '../api/discussions';
import { getToken } from '../api/client';
import { uk } from '../copy/uk';

const t = uk.history;

const VIEW_KEY = 'clarity:history-view';
const SKELETON_COUNT = 6;
// найвужча колонка сітки; на телефоні поруч із панеллю зазвичай вміщається одна
const COLUMN_MIN = 250;
const COLUMN_GAP = 16;
const COLUMN_MIN_PHONE = 150;
const COLUMN_GAP_PHONE = 12;
// скільки чекаємо перед переходом, щоб «желейний» відскок картки встиг проявитися
const PRESS_DELAY = 160;
const DAY = 24 * 60 * 60 * 1000;
const GROUP_ORDER = ['today', 'yesterday', 'week', 'older'];

const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const timeFormat = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat('uk-UA', { weekday: 'long' });
const dayFormat = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' });
const fullDayFormat = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Скільки календарних днів минуло від дати до сьогодні
const daysAgo = (date, now) => {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startOfToday - startOfDate) / DAY);
};

const groupOf = (value, now) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'older';
  const days = daysAgo(date, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  return 'older';
};

// «Сьогодні, 16:36», «Вчора, 11:48», «Понеділок, 19:00», «11 вер., 19:00».
// У списку день уже названо в заголовку групи, тож для сьогодні й учора лишаємо час.
// Повертає день окремо від часу, щоб на вузькій картці переносився лише між ними.
const formatWhen = (value, now, { timeOnlyRecent = false } = {}) => {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return { day: '', time: '' };
  const days = daysAgo(date, now);
  const time = timeFormat.format(date);
  if (days <= 1 && timeOnlyRecent) return { day: '', time };
  let day;
  if (days <= 0) day = t.today;
  else if (days === 1) day = t.yesterday;
  else if (days < 7) day = capitalize(weekdayFormat.format(date));
  else if (date.getFullYear() === now.getFullYear()) day = dayFormat.format(date);
  else day = fullDayFormat.format(date);
  return { day: `${day}, `, time };
};

// Скільки колонок вміщає сітка — від цього залежить розкладка «цеглинками»
function useColumnCount(node) {
  const [count, setCount] = useState(2);
  useLayoutEffect(() => {
    if (!node) return undefined;
    const measure = () => {
      const isPhone = window.matchMedia('(max-width: 639px)').matches;
      const min = isPhone ? COLUMN_MIN_PHONE : COLUMN_MIN;
      const gap = isPhone ? COLUMN_GAP_PHONE : COLUMN_GAP;
      const fit = Math.floor((node.clientWidth + gap) / (min + gap));
      setCount(Math.min(4, Math.max(1, fit)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return count;
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [view, setView] = useState(readView);
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  // точка відліку для «Сьогодні», «Вчора»… — оновлюється з кожним завантаженням
  const [now, setNow] = useState(() => new Date());
  const [gridNode, setGridNode] = useState(null);
  const searchRef = useRef(null);
  const toggleRef = useRef(null);
  const openTimer = useRef(null);
  const columnCount = useColumnCount(gridNode);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await fetchDiscussions();
      setItems(data?.results || []);
      setNow(new Date());
    } catch (err) {
      setError(err.message || t.loadError);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      navigate('/login', { replace: true });
      return undefined;
    }
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load, navigate]);

  useEffect(() => () => clearTimeout(openTimer.current), []);

  const changeView = (next) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // приватний режим — просто не запам'ятовуємо
    }
  };

  const openSearch = () => {
    setIsSearchOpen(true);
    searchRef.current?.focus({ preventScroll: true });
  };

  const closeSearch = () => {
    setQuery('');
    setIsSearchOpen(false);
    toggleRef.current?.focus({ preventScroll: true });
  };

  // поле без тексту ховається назад у кнопку, коли фокус іде деінде на сторінці;
  // перехід в інше вікно чи застосунок пошук не закриває
  const handleSearchBlur = (event) => {
    if (query || !document.hasFocus() || event.currentTarget.contains(event.relatedTarget)) return;
    setIsSearchOpen(false);
  };

  const openDiscussion = (id) => {
    clearTimeout(openTimer.current);
    if (prefersReducedMotion()) {
      navigate(`/chat/${id}`);
      return;
    }
    openTimer.current = setTimeout(() => navigate(`/chat/${id}`), PRESS_DELAY);
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.question?.toLowerCase().includes(needle));
  }, [items, query]);

  const skeletons = useMemo(
    () => Array.from({ length: SKELETON_COUNT }, (_, index) => ({ skeleton: index })),
    [],
  );

  // картки розкладаються по колонках зліва направо, рядок за рядком
  const columns = useMemo(() => {
    const result = Array.from({ length: columnCount }, () => []);
    (isLoading ? skeletons : visible).forEach((item, index) => result[index % columnCount].push(item));
    return result;
  }, [visible, columnCount, isLoading, skeletons]);

  const groups = useMemo(() => {
    const buckets = new Map();
    visible.forEach((item) => {
      const key = groupOf(item.created_at, now);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    });
    return GROUP_ORDER.filter((key) => buckets.has(key)).map((key) => ({ key, items: buckets.get(key) }));
  }, [visible, now]);

  const handleDelete = async (id) => {
    if (deletingId) return;
    if (!window.confirm(t.deleteConfirm)) return;
    setDeletingId(id);
    setError('');
    try {
      await deleteDiscussion(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      setError(err.message || t.deleteError);
    } finally {
      setDeletingId(null);
    }
  };

  const hasItems = !isLoading && items.length > 0;

  const renderCard = (item, options) => {
    if ('skeleton' in item) {
      return (
        <li key={`skeleton-${item.skeleton}`} className="history__card history__card--skeleton" aria-hidden="true">
          <span className="history__skeleton history__skeleton--date" />
          <span className="history__skeleton history__skeleton--title" />
          <span className="history__skeleton history__skeleton--title history__skeleton--short" />
        </li>
      );
    }
    const status = t.statuses[item.status] || item.status;
    const when = formatWhen(item.created_at, now, options);
    return (
      <li
        key={item.id}
        className={`history__card${deletingId === item.id ? ' history__card--deleting' : ''}`}
      >
        <button
          type="button"
          className="history__open"
          onClick={() => openDiscussion(item.id)}
          title={item.question}
        >
          <span className="history__question">{item.question}</span>
        </button>
        {options?.withPreview && item.preview && <p className="history__preview">{item.preview}</p>}
        <time className="history__when" dateTime={item.created_at}>
          {when.day}
          <span className="history__time">
            {when.time}
            <span
              className={`history__dot history__dot--${item.status}`}
              role="img"
              aria-label={status}
              title={status}
            />
          </span>
        </time>
        <button
          type="button"
          className="history__delete"
          onClick={() => handleDelete(item.id)}
          disabled={deletingId === item.id}
          aria-label={deletingId === item.id ? t.deleting : t.deleteNamed(item.question)}
          title={t.delete}
        >
          <HugeiconsIcon icon={Delete02Icon} size={18} aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <main className={`history history--${view}`}>
      <div className="history__scroll" aria-busy={isLoading}>
        <div className="history__inner">
          <h1 className="history__sr-only">{t.title}</h1>

          {error && (
            <div className="history__error" role="alert">
              <p>{error}</p>
              {!isLoading && (
                <button type="button" className="history__retry" onClick={load}>
                  {t.retry}
                </button>
              )}
            </div>
          )}

          {isLoading && <p className="history__sr-only" role="status">{t.loading}</p>}

          {!isLoading && items.length === 0 && !error && (
            <div className="history__empty">
              <p>{t.empty}</p>
              <button type="button" className="history__retry" onClick={() => navigate('/home')}>
                {t.newDiscussion}
              </button>
            </div>
          )}

          {hasItems && visible.length === 0 && <p className="history__empty">{t.noResults}</p>}

          {(isLoading || visible.length > 0) &&
            (view === 'grid' ? (
              <div className="history__grid" ref={setGridNode} role="list">
                {columns.map((column, index) => (
                  <ul key={index} className="history__column" role="presentation">
                    {column.map((item) => renderCard(item))}
                  </ul>
                ))}
              </div>
            ) : isLoading ? (
              <ul className="history__list">{skeletons.map((item) => renderCard(item))}</ul>
            ) : (
              groups.map((group) => (
                <section key={group.key} className="history__group" aria-labelledby={`history-group-${group.key}`}>
                  <h2 id={`history-group-${group.key}`} className="history__group-title">
                    {t.groups[group.key]}
                  </h2>
                  <ul className="history__list">
                    {group.items.map((item) => renderCard(item, { timeOnlyRecent: true, withPreview: true }))}
                  </ul>
                </section>
              ))
            ))}
        </div>
      </div>

      {/* вертикальна панель: пошук і вигляд угорі, нова дискусія внизу */}
      <aside className="history__rail" aria-label={t.toolbar}>
        <div className="history__rail-group">
          {/* поле пошуку «виростає» з круглої кнопки ліворуч і ховається назад у неї */}
          <div
            className={`history__searchbox${isSearchOpen ? ' history__searchbox--open' : ''}`}
            onBlur={handleSearchBlur}
          >
            <input
              ref={searchRef}
              type="search"
              className="history__search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && closeSearch()}
              placeholder={t.searchPlaceholder}
              aria-label={t.search}
              tabIndex={isSearchOpen ? 0 : -1}
              aria-hidden={!isSearchOpen}
            />
            <button
              ref={toggleRef}
              type="button"
              className="history__rail-button history__search-toggle"
              // фокус лишається в полі: інакше в Safari blur встигає закрити пошук,
              // а наступний click відкриває його знову
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => (isSearchOpen ? closeSearch() : openSearch())}
              aria-label={isSearchOpen ? t.closeSearch : t.openSearch}
              aria-expanded={isSearchOpen}
              title={isSearchOpen ? t.closeSearch : t.openSearch}
              disabled={!hasItems}
            >
              <HugeiconsIcon className="history__search-icon" icon={Search01Icon} size={22} aria-hidden="true" />
              <HugeiconsIcon className="history__close-icon" icon={Cancel01Icon} size={22} aria-hidden="true" />
            </button>
          </div>

          <div className="history__views" role="group" aria-label={t.viewLabel}>
            {[
              ['grid', GridViewIcon, t.viewGrid],
              ['list', ListViewIcon, t.viewList],
            ].map(([key, icon, label]) => (
              <button
                key={key}
                type="button"
                className={`history__rail-button history__view${view === key ? ' history__view--active' : ''}`}
                aria-pressed={view === key}
                aria-label={label}
                title={label}
                onClick={() => changeView(key)}
              >
                <HugeiconsIcon icon={icon} size={22} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="history__rail-button history__new"
          onClick={() => navigate('/home')}
          aria-label={t.newDiscussion}
          title={t.newDiscussion}
        >
          <HugeiconsIcon icon={PencilEdit02Icon} size={22} aria-hidden="true" />
        </button>
      </aside>
    </main>
  );
}
