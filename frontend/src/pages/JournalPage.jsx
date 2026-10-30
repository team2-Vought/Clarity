import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Delete02Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { deleteDecision, fetchJournal, updateDecision } from '../api/journal';
import { fetchSettings, updatePreferences } from '../api/settings';
import { refreshJournalDue } from '../hooks/useJournalDue';
import { useToasts } from '../hooks/useToasts';
import { InlineText } from '../components/MessageMarkdown';
import { copy, locale } from '../copy';

const t = copy.journal;
const OUTCOMES = ['good', 'mixed', 'bad'];
const REFLECTION_MAX = 1000;
const NO_SOURCES = new Map();

const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });
const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
};

/** «Як воно?»: як вийшло й висновок для себе; «ще рано» відкладає питання на тиждень. */
function ReviewForm({ entry, onSaved }) {
  const id = useId();
  const [outcome, setOutcome] = useState(entry.outcome || '');
  const [reflection, setReflection] = useState(entry.reflection || '');
  const [busy, setBusy] = useState(false);
  const { pushToast } = useToasts();

  const save = async (changes) => {
    setBusy(true);
    try {
      onSaved(await updateDecision(entry.id, changes));
      refreshJournalDue();
    } catch (err) {
      pushToast(err?.message || t.saveError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="journal__review">
      <span className="journal__label" id={`${id}-outcome`}>{t.howIsIt}</span>
      <div className="journal__outcomes" role="radiogroup" aria-labelledby={`${id}-outcome`}>
        {OUTCOMES.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={outcome === key}
            className={`journal__outcome journal__outcome--${key} ${outcome === key ? 'journal__outcome--active' : ''}`}
            onClick={() => setOutcome(key)}
            disabled={busy}
          >
            {t.outcomes[key]}
          </button>
        ))}
      </div>
      <label className="journal__label" htmlFor={`${id}-reflection`}>{t.reflection}</label>
      <textarea
        id={`${id}-reflection`}
        className="journal__textarea"
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
        placeholder={t.reflectionPlaceholder}
        maxLength={REFLECTION_MAX}
        rows={3}
        disabled={busy}
      />
      <div className="journal__actions">
        <button
          type="button"
          className="journal__button"
          onClick={() => save({ remind_in_days: 7 })}
          disabled={busy}
        >
          {t.tooEarly}
        </button>
        <button
          type="button"
          className="journal__button journal__button--primary"
          onClick={() => save({ outcome, reflection })}
          disabled={busy || !outcome}
        >
          {busy ? t.saving : t.save}
        </button>
      </div>
    </div>
  );
}

ReviewForm.propTypes = {
  entry: PropTypes.object.isRequired,
  onSaved: PropTypes.func.isRequired,
};

function JournalEntry({ entry, focused, onChange, onRemove }) {
  const navigate = useNavigate();
  const ref = useRef(null);
  const [reviewing, setReviewing] = useState(focused || entry.status === 'due');
  const { pushToast } = useToasts();
  const done = new Set(entry.done_steps || []);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);

  const toggleStep = async (index) => {
    const next = new Set(done);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    const doneSteps = [...next].sort((a, b) => a - b);
    // галочка ставиться одразу; якщо сервер не прийняв — повертаємо як було
    onChange({ ...entry, done_steps: doneSteps });
    try {
      onChange(await updateDecision(entry.id, { done_steps: doneSteps }));
    } catch (err) {
      onChange(entry);
      pushToast(err?.message || t.saveError);
    }
  };

  const remove = async () => {
    if (!window.confirm(t.removeConfirm)) return;
    try {
      await deleteDecision(entry.id);
      onRemove(entry.id);
      refreshJournalDue();
    } catch (err) {
      pushToast(err?.message || t.saveError);
    }
  };

  const meta = [t.decidedOn(formatDate(entry.created_at))];
  if (entry.status === 'waiting') meta.push(t.askOn(formatDate(entry.check_at)));
  if (entry.status === 'reviewed') meta.push(t.reviewedOn(formatDate(entry.reviewed_at)));

  return (
    <li
      ref={ref}
      className={`journal__entry journal__entry--${entry.status} ${focused ? 'journal__entry--focused' : ''}`}
    >
      <div className="journal__entry-head">
        <p className="journal__question">{entry.question}</p>
        <div className="journal__entry-tools">
          {entry.discussion_id && (
            <button
              type="button"
              className="journal__icon-button"
              onClick={() => navigate(`/chat/${entry.discussion_id}`)}
              aria-label={t.openDiscussion}
              title={t.openDiscussion}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="journal__icon-button"
            onClick={remove}
            aria-label={t.remove}
            title={t.remove}
          >
            <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="journal__decision">{entry.decision}</p>
      <p className="journal__meta">{meta.join(' · ')}</p>

      {entry.status === 'reviewed' && entry.outcome && (
        <div className="journal__result">
          <span className={`journal__chip journal__chip--${entry.outcome}`}>{t.outcomes[entry.outcome]}</span>
          {entry.reflection && <p className="journal__reflection">{entry.reflection}</p>}
        </div>
      )}

      {entry.steps?.length > 0 && (
        <section className="journal__block">
          <h3 className="journal__label">
            {t.plan}
            <span className="journal__progress">{t.planProgress(done.size, entry.steps.length)}</span>
          </h3>
          <ul className="journal__steps">
            {entry.steps.map((step, index) => (
              <li key={`${entry.id}-${index}`}>
                <label className={`journal__step ${done.has(index) ? 'journal__step--done' : ''}`}>
                  <input type="checkbox" checked={done.has(index)} onChange={() => toggleStep(index)} />
                  <span className="journal__check" aria-hidden="true">
                    {done.has(index) && <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.4} />}
                  </span>
                  <span>
                    <InlineText text={step} sources={NO_SOURCES} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {entry.triggers?.length > 0 && (
        <details className="journal__block journal__triggers">
          <summary className="journal__label">{t.triggers}</summary>
          <ul>
            {entry.triggers.map((item, index) => (
              <li key={`${entry.id}-trigger-${index}`}>
                <InlineText text={item} sources={NO_SOURCES} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {entry.status !== 'reviewed' && (reviewing ? (
        <ReviewForm entry={entry} onSaved={onChange} />
      ) : (
        <button type="button" className="journal__link" onClick={() => setReviewing(true)}>
          {t.reviewNow}
        </button>
      ))}
    </li>
  );
}

JournalEntry.propTypes = {
  entry: PropTypes.object.isRequired,
  focused: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

/** Журнал рішень: що чекає на «Як воно?», що ще чекає свого часу й історія підсумків. */
export default function JournalPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('review');
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [emails, setEmails] = useState(null);
  const switchId = useId();
  const { pushToast } = useToasts();

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await fetchJournal();
      setEntries(data.results || []);
    } catch (err) {
      setError(err?.message || t.loadError);
    }
    fetchSettings()
      .then((data) => setEmails(data?.preferences?.journal_emails !== false))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const previous = document.title;
    document.title = `${t.title} · ${copy.appName}`;
    return () => {
      document.title = previous;
    };
  }, []);

  const changeEmails = async (value) => {
    setEmails(value);
    try {
      await updatePreferences({ journal_emails: value });
    } catch (err) {
      setEmails(!value);
      pushToast(err?.message || t.saveError);
    }
  };

  const replace = (next) =>
    setEntries((current) => current.map((item) => (item.id === next.id ? next : item)));
  const remove = (entryId) => setEntries((current) => current.filter((item) => item.id !== entryId));

  const groups = useMemo(() => {
    const byStatus = { due: [], waiting: [], reviewed: [] };
    (entries || []).forEach((entry) => byStatus[entry.status]?.push(entry));
    return [
      { key: 'due', title: t.due, items: byStatus.due },
      { key: 'waiting', title: t.waiting, items: byStatus.waiting },
      { key: 'reviewed', title: t.reviewed, items: byStatus.reviewed },
    ].filter((group) => group.items.length > 0);
  }, [entries]);

  return (
    <div className="journal">
      <div className="journal__inner">
        <header className="journal__head">
          <h1 className="journal__title">{t.title}</h1>
          <p className="journal__lead">{t.lead}</p>
          {emails !== null && (
            <label className="journal__setting" htmlFor={switchId}>
              <span>
                <span className="journal__setting-title">{t.emails}</span>
                <span className="journal__setting-hint">{t.emailsHint}</span>
              </span>
              <input
                id={switchId}
                type="checkbox"
                role="switch"
                className="debate__switch-input"
                checked={emails}
                onChange={(e) => changeEmails(e.target.checked)}
              />
            </label>
          )}
        </header>

        {error && (
          <div className="journal__empty" role="alert">
            <p>{error}</p>
            <button type="button" className="journal__button" onClick={load}>
              {t.retry}
            </button>
          </div>
        )}

        {!error && entries === null && (
          <div className="journal__skeleton" aria-hidden="true">
            <span />
            <span />
          </div>
        )}

        {entries?.length === 0 && (
          <div className="journal__empty">
            <p>{t.empty}</p>
            <button
              type="button"
              className="journal__button journal__button--primary"
              onClick={() => navigate('/home')}
            >
              {t.emptyAction}
            </button>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.key} className="journal__group" aria-labelledby={`journal-${group.key}`}>
            <h2 id={`journal-${group.key}`} className="journal__group-title">
              {group.title}
              <span className="journal__group-count">{group.items.length}</span>
            </h2>
            <ul className="journal__list">
              {group.items.map((entry) => (
                <JournalEntry
                  key={entry.id}
                  entry={entry}
                  focused={String(entry.id) === focusId}
                  onChange={replace}
                  onRemove={remove}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
