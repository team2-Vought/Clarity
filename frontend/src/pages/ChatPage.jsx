import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchDiscussion, advanceDiscussion } from '../api/discussions';
import { uk } from '../copy/uk';

const t = uk.chat;
const d = uk.debate;

const PARTICIPANT_COLORS = ['#b4b5ce', '#c2effd', '#f4c1cf', '#d3f0dc', '#fff1b8'];
const DEVIL_COLOR = '#feedd5';
const USER_COLOR = '#f0f0f0';

export default function ChatPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [discussion, setDiscussion] = useState(null);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [error, setError] = useState('');

  const loadDiscussion = useCallback(async () => {
    try {
      const data = await fetchDiscussion(id);
      setDiscussion(data);
      setError('');
    } catch (err) {
      setError(err.message || 'Не вдалося завантажити дискусію');
    }
  }, [id]);

  useEffect(() => {
    loadDiscussion();
  }, [loadDiscussion]);

  const handleAdvance = async () => {
    if (isAdvancing) return;
    setIsAdvancing(true);
    setError('');
    try {
      const data = await advanceDiscussion(id);
      if (data.message) {
        setDiscussion((prev) =>
          prev ? { ...prev, messages: [...prev.messages, data.message] } : prev
        );
      }
      if (data.discussion.is_finished) {
        setDiscussion((prev) => (prev ? { ...prev, ...data.discussion } : prev));
      }
    } catch (err) {
      setError(err.message || 'Помилка при створенні повідомлення');
    } finally {
      setIsAdvancing(false);
    }
  };

  const messages = discussion?.messages || [];
  const isFinished = discussion ? discussion.phase === 'final' || discussion.is_finished : false;

  // Колір і бік для кожного мовця: учасники чергуються лівий/правий, Devil і користувач — справа
  const speakers = useMemo(() => {
    const map = new Map();
    let i = 0;
    messages.forEach((m) => {
      const key = m.persona_name || m.role;
      if (map.has(key)) return;
      if (m.role === 'devil') map.set(key, { color: DEVIL_COLOR, side: 'right', participant: true });
      else if (m.role === 'moderator') map.set(key, { color: DEVIL_COLOR, side: 'left', participant: false });
      else if (m.role === 'user') map.set(key, { color: USER_COLOR, side: 'right', participant: false });
      else {
        map.set(key, {
          color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length],
          side: i % 2 === 0 ? 'left' : 'right',
          participant: true,
        });
        i += 1;
      }
    });
    return map;
  }, [messages]);

  const participantNames = [...speakers.entries()].filter(([, s]) => s.participant).map(([name]) => name);

  return (
    <div className="debate-page chat-page">
      <aside className="debate__form-panel">
        {discussion && (
          <>
            <section className="debate__section">
              <h2 className="debate__section-title">{d.description}</h2>
              <p className="debate__card chat__question">{discussion.question}</p>
            </section>
            {participantNames.length > 0 && (
              <section className="debate__section">
                <h2 className="debate__section-title">{d.participants}</h2>
                <div className="debate__trait-list">
                  {participantNames.map((name) => (
                    <span
                      key={name}
                      className="debate__trait-chip debate__trait-chip--active"
                      style={{ '--chip': speakers.get(name).color }}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </section>
            )}
            {isFinished && <span className="chat__status">Завершено</span>}
          </>
        )}
        <button
          type="button"
          className="debate__start-btn"
          onClick={() => navigate('/home', { replace: true })}
        >
          {t.back}
        </button>
      </aside>

      <section className="chat__main">
        {error && (
          <p className="debate__error" role="alert">
            {error}
          </p>
        )}

        {(!discussion || messages.length === 0) && <div className="chat__empty">{t.empty}</div>}

        {messages.map((msg) => {
          const key = msg.persona_name || msg.role;
          const { color, side } = speakers.get(key) || { color: USER_COLOR, side: 'left' };
          const initial = (msg.persona_name || '?').charAt(0);
          return (
            <div key={msg.id} className={`chat__row chat__row--${side}`}>
              <span className="chat__avatar" aria-hidden="true">
                {msg.avatar || initial}
              </span>
              <div className="chat__body">
                <div className="chat__bubble" style={{ '--bubble': color }}>
                  <div className="chat__name">
                    {msg.persona_name}
                    {msg.role === 'moderator' && <span className="chat__tag">{t.messages}</span>}
                  </div>
                  <div className="chat__text">{msg.content}</div>
                </div>
                <time className="chat__time">
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
            </div>
          );
        })}

        {discussion && !isFinished && !isAdvancing && (
          <button type="button" className="chat__advance" onClick={handleAdvance}>
            Далі
          </button>
        )}
        {isAdvancing && <div className="chat__advance chat__advance--loading">{t.advancing}</div>}
      </section>
    </div>
  );
}