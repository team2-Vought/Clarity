import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteDiscussion, fetchDiscussions } from '../api/discussions';
import { getToken } from '../api/client';
import { uk } from '../copy/uk';

const t = uk.history;

const formatDate = (value) => {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('uk-UA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '';
  }
};

export default function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await fetchDiscussions();
      setItems(data?.results || []);
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

  return (
    <main className="history">
      <header className="history__header">
        <div>
          <h1 className="history__title">{t.title}</h1>
          <p className="history__subtitle">{t.subtitle}</p>
        </div>
        <button
          type="button"
          className="history__new"
          onClick={() => navigate('/home')}
        >
          {t.newDiscussion}
        </button>
      </header>

      {error && (
        <div className="history__error-block">
          <p className="debate__error" role="alert">
            {error}
          </p>
          {!isLoading && (
            <button type="button" className="history__retry" onClick={load}>
              {t.retry}
            </button>
          )}
        </div>
      )}

      {isLoading && <p className="history__empty" role="status">{t.loading}</p>}

      {!isLoading && items.length === 0 && !error && (
        <div className="history__empty">
          <p>{t.empty}</p>
          <button
            type="button"
            className="history__new"
            onClick={() => navigate('/home')}
          >
            {t.newDiscussion}
          </button>
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <ul className="history__list">
          {items.map((item) => (
            <li key={item.id} className="history__card">
              <button
                type="button"
                className="history__open"
                onClick={() => navigate(`/chat/${item.id}`)}
              >
                <span className="history__question">{item.question}</span>
                <span className="history__meta">
                  <span>{t.modes[item.mode] || item.mode}</span>
                  <span>{t.rounds(item.rounds)}</span>
                  <span>{t.messages(item.message_count)}</span>
                  <span>{formatDate(item.created_at)}</span>
                </span>
              </button>
              <div className="history__actions">
                <span className={`history__status history__status--${item.status}`}>
                  {t.statuses[item.status] || item.status}
                </span>
                <button
                  type="button"
                  className="history__delete"
                  onClick={() => handleDelete(item.id)}
                  disabled={deletingId === item.id}
                >
                  {deletingId === item.id ? t.deleting : t.delete}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
