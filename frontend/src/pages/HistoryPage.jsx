import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Archive02Icon,
  Cancel01Icon,
  Delete02Icon,
  GridViewIcon,
  ListViewIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  Search01Icon,
  Unarchive03Icon,
} from '@hugeicons/core-free-icons';
import { deleteDiscussion, fetchDiscussions, updateDiscussion } from '../api/discussions';
import { useToasts } from '../hooks/useToasts';
import { getToken } from '../api/client';
import { uk } from '../copy/uk';

const t = uk.history;

const VIEW_KEY = 'clarity:history-view';
const SKELETON_COUNT = 6;
// найвужча колонка сітки на ширших екранах
const COLUMN_MIN = 250;
const COLUMN_GAP = 16;
// скільки чекаємо перед переходом, щоб картка встигла помітно «втиснутися»
const PRESS_DELAY = 160;
const DAY = 24 * 60 * 60 * 1000;
const GROUP_ORDER = ['pinned', 'today', 'yesterday', 'week', 'older'];

// закріплені — першими, далі від нових до старих (як сортує сервер)
const byPinThenDate = (a, b) =>
  Number(b.pinned) - Number(a.pinned) || new Date(b.created_at) - new Date(a.created_at);
const SEARCH_DELAY = 300;
// стільки секунд можна скасувати видалення
const UNDO_MS = 5000;
const REFRESH_MS = 5000;

// «Раунд 2 з 3», «Перевірка AI Devil»… — що відбувається з дискусією зараз
const progressOf = (item) => {
  if (item.status !== 'in_progress') return '';
  if (item.phase === 'debate') {
    return item.until_consensus
      ? t.progressRoundConsensus(item.current_round || 1)
      : t.progressRound(item.current_round || 1, item.rounds || 1);
  }
  return t.phases[item.phase] || '';
};

const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};

const prefersReducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced'
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      // на телефоні завжди дві колонки — картки компактні й вміщаються
      if (window.matchMedia('(max-width: 639px)').matches) {
        setCount(2);
        return;
      }
      const fit = Math.floor((node.clientWidth + COLUMN_GAP) / (COLUMN_MIN + COLUMN_GAP));
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
  const [nextOffset, setNextOffset] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');
  // архів — окремий розділ: архівні дискусії не змішуються з рештою
  const [isArchive, setIsArchive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // видалена, але ще не стерта на сервері дискусія: її можна повернути
  const [pendingDelete, setPendingDelete] = useState(null);
  const pendingRef = useRef(null);
  const { pushToast } = useToasts();
  const listParams = { archived: isArchive, q: searchTerm };
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
      const data = await fetchDiscussions({ archived: isArchive, q: searchTerm });
      setItems(data?.results || []);
      setNextOffset(data?.next_offset ?? null);
      setNow(new Date());
    } catch (err) {
      setError(err.message || t.loadError);
    } finally {
      setIsLoading(false);
    }
  }, [isArchive, searchTerm]);

  const loadMore = async () => {
    if (nextOffset === null || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const data = await fetchDiscussions({ ...listParams, offset: nextOffset });
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...(data?.results || []).filter((item) => !known.has(item.id))];
      });
      setNextOffset(data?.next_offset ?? null);
    } catch (err) {
      setError(err.message || t.loadError);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // пошук іде на сервер, коли користувач на мить зупинився
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query.trim()), SEARCH_DELAY);
    return () => clearTimeout(timer);
  }, [query]);

  // дискусії, що виконуються, оновлюють свій прогрес без перезавантаження сторінки
  const hasRunning = items.some((item) => item.is_running);
  const loadedCount = items.length;
  useEffect(() => {
    if (!hasRunning) return undefined;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const data = await fetchDiscussions({
          limit: loadedCount,
          archived: isArchive,
          q: searchTerm,
          signal: controller.signal,
        });
        const fresh = new Map((data?.results || []).map((item) => [item.id, item]));
        setItems((current) => current.map((item) => fresh.get(item.id) || item));
      } catch {
        // наступне оновлення спробує ще раз
      }
    }, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [hasRunning, loadedCount, isArchive, searchTerm]);

  const commitDelete = useCallback(async (pending) => {
    clearTimeout(pending.timer);
    if (pendingRef.current === pending) pendingRef.current = null;
    setPendingDelete((current) => (current === pending ? null : current));
    try {
      await deleteDiscussion(pending.item.id);
    } catch (err) {
      // не вдалося — повертаємо картку на місце
      setItems((current) => {
        const next = [...current];
        next.splice(Math.min(pending.index, next.length), 0, pending.item);
        return next;
      });
      setError(err.message || t.deleteError);
    }
  }, []);

  // при виході зі сторінки відкладене видалення виконується одразу
  useEffect(
    () => () => {
      if (pendingRef.current) commitDelete(pendingRef.current);
    },
    [commitDelete]
  );

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

  const visible = items;
  const isFiltered = Boolean(isArchive || searchTerm);

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
      const key = item.pinned ? 'pinned' : groupOf(item.created_at, now);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    });
    return GROUP_ORDER.filter((key) => buckets.has(key)).map((key) => ({ key, items: buckets.get(key) }));
  }, [visible, now]);

  // Видалення без діалогу: картка зникає одразу, а сервер стирає її через
  // кілька секунд, якщо користувач не натиснув «Скасувати»
  const handleDelete = (id) => {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;
    if (pendingRef.current) commitDelete(pendingRef.current);
    setError('');
    const pending = { item: items[index], index };
    pending.timer = setTimeout(() => commitDelete(pending), UNDO_MS);
    pendingRef.current = pending;
    setPendingDelete(pending);
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const undoDelete = () => {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    setPendingDelete(null);
    setItems((current) => {
      const next = [...current];
      next.splice(Math.min(pending.index, next.length), 0, pending.item);
      return next;
    });
  };

  const togglePin = async (item) => {
    const pinned = !item.pinned;
    const apply = (value) =>
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, pinned: value } : entry)).sort(byPinThenDate)
      );
    apply(pinned);
    try {
      await updateDiscussion(item.id, { pinned });
    } catch (err) {
      apply(!pinned);
      setError(err.message || t.updateError);
    }
  };

  // з архіву й до архіву дискусія переходить в інший розділ, тож зникає з поточного
  const toggleArchive = async (item) => {
    const archived = !item.archived;
    const index = items.findIndex((entry) => entry.id === item.id);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    try {
      await updateDiscussion(item.id, { archived, ...(archived ? { pinned: false } : {}) });
      pushToast(archived ? t.archivedToast : t.unarchivedToast);
    } catch (err) {
      setItems((current) => {
        const next = [...current];
        next.splice(Math.min(index, next.length), 0, item);
        return next;
      });
      setError(err.message || t.updateError);
    }
  };

  const hasItems = !isLoading && (items.length > 0 || isFiltered);

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
    const progress = progressOf(item);
    const when = formatWhen(item.created_at, now, options);
    const name = item.title || item.question;
    return (
      <li
        key={item.id}
        className="history__card"
      >
        <button
          type="button"
          className="history__open"
          onClick={() => openDiscussion(item.id)}
          title={item.question}
        >
          <span className="history__question">{item.title || item.question}</span>
        </button>
        {item.preview && <p className="history__preview">{item.preview}</p>}
        {progress && <p className="history__progress">{progress}</p>}
        <time className="history__when" dateTime={item.created_at}>
          {item.pinned && (
            <HugeiconsIcon
              icon={PinIcon}
              size={14}
              className="history__pin-mark"
              aria-label={t.pinnedMark}
            />
          )}
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
        <div className="history__actions">
          {!item.archived && (
            <button
              type="button"
              className="history__action"
              onClick={() => togglePin(item)}
              aria-pressed={Boolean(item.pinned)}
              aria-label={item.pinned ? t.unpinNamed(name) : t.pinNamed(name)}
              title={item.pinned ? t.unpin : t.pin}
            >
              <HugeiconsIcon icon={item.pinned ? PinOffIcon : PinIcon} size={18} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="history__action"
            onClick={() => toggleArchive(item)}
            aria-label={item.archived ? t.unarchiveNamed(name) : t.archiveNamed(name)}
            title={item.archived ? t.unarchive : t.archive}
          >
            <HugeiconsIcon icon={item.archived ? Unarchive03Icon : Archive02Icon} size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="history__action history__delete"
            onClick={() => handleDelete(item.id)}
            aria-label={t.deleteNamed(name)}
            title={t.delete}
          >
            <HugeiconsIcon icon={Delete02Icon} size={18} aria-hidden="true" />
          </button>
        </div>
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

          {!isLoading && items.length === 0 && !error && !isFiltered && (
            <p className="history__empty history__empty--blank">{t.empty}</p>
          )}

          {!isLoading && isFiltered && visible.length === 0 && (
            <p className="history__empty">{isArchive && !searchTerm ? t.archiveEmpty : t.noResults}</p>
          )}

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
                    {group.items.map((item) => renderCard(item, { timeOnlyRecent: true }))}
                  </ul>
                </section>
              ))
            ))}

          {!isLoading && nextOffset !== null && (
            <div className="history__more">
              <button
                type="button"
                className="history__retry"
                onClick={loadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? t.loadingMore : t.loadMore}
              </button>
            </div>
          )}
        </div>
      </div>

      {pendingDelete && (
        <div className="history__undo" role="status">
          <span>{t.deleted}</span>
          <button type="button" className="history__undo-button" onClick={undoDelete}>
            {t.undo}
          </button>
        </div>
      )}

      {/* вертикальна панель: пошук, вигляд і архів угорі, нова дискусія внизу */}
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

          <button
            type="button"
            className={`history__rail-button history__archive${isArchive ? ' history__archive--active' : ''}`}
            aria-pressed={isArchive}
            aria-label={t.archiveSection}
            title={t.archiveSection}
            onClick={() => setIsArchive((current) => !current)}
          >
            <HugeiconsIcon icon={Archive02Icon} size={22} aria-hidden="true" />
          </button>
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
