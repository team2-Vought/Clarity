import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  Delete02Icon,
  Mail01Icon,
  MailRemove01Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
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
const SKELETON_COUNT = 3;
// скільки триває згортання картки — як анімація journal-fold у стилях
const FOLD_MS = 260;

const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });
const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
};

const prefersReducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced'
  || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** «Як воно?»: як вийшло й висновок для себе; «ще рано» відкладає питання на тиждень. */
function ReviewForm({ entry, initialOutcome, onSaved }) {
  const id = useId();
  const [outcome, setOutcome] = useState(initialOutcome || entry.outcome || '');
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
  initialOutcome: PropTypes.string,
  onSaved: PropTypes.func.isRequired,
};

// Картка рішення: згорнута — що вирішили, коли й скільки кроків зроблено;
// розгорнута — план, «коли передумати» й «Як воно?». На тих, що чекають підсумку,
// «Як воно?» видно й у згорнутій: вибір відповіді відкриває картку з формою.
function JournalEntry({ entry, focused, onChange, onRemove }) {
  const navigate = useNavigate();
  const ref = useRef(null);
  const bodyId = useId();
  const quickId = useId();
  const [open, setOpen] = useState(Boolean(focused));
  // згортання спершу програє анімацію, і лише після неї вміст зникає
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null);
  // «Як воно?» на згорнутій картці виростає, лише коли картку щойно згорнули
  const [quickAppears, setQuickAppears] = useState(false);
  const expanded = open && !closing;
  const [reviewing, setReviewing] = useState(focused || entry.status === 'due');
  const [quickOutcome, setQuickOutcome] = useState('');
  const { pushToast } = useToasts();
  const done = new Set(entry.done_steps || []);
  const steps = entry.steps || [];
  const triggers = entry.triggers || [];
  const hasDetails = steps.length > 0 || triggers.length > 0 || entry.status !== 'reviewed';

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

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

  // таймер, а не animationend: у фоновій вкладці подія може не прийти, і картка застрягла б
  const toggle = () => {
    clearTimeout(closeTimer.current);
    if (!open) {
      setOpen(true);
    } else if (closing) {
      setClosing(false);
    } else if (prefersReducedMotion()) {
      setOpen(false);
    } else {
      setClosing(true);
      closeTimer.current = setTimeout(() => {
        setClosing(false);
        setOpen(false);
        setQuickAppears(true);
      }, FOLD_MS);
    }
  };

  const meta = [t.decidedOn(formatDate(entry.created_at))];
  if (entry.status === 'waiting') meta.push(t.askOn(formatDate(entry.check_at)));
  if (entry.status === 'reviewed') meta.push(t.reviewedOn(formatDate(entry.reviewed_at)));
  // колір крапки: чекає підсумку, ще рано або як вийшло
  const dot = entry.status === 'reviewed' ? entry.outcome || 'reviewed' : entry.status;

  const summary = (
    <>
      <span className="journal__when">
        <span className={`journal__dot journal__dot--${dot}`} aria-hidden="true" />
        {meta.join(' · ')}
      </span>
      <span className="journal__decision">{entry.decision}</span>
      <span className="journal__question">{entry.question}</span>
    </>
  );

  return (
    <li
      ref={ref}
      className={`journal__entry journal__entry--${entry.status}${expanded ? ' journal__entry--open' : ''}${focused ? ' journal__entry--focused' : ''}`}
    >
      {hasDetails ? (
        <button
          type="button"
          className="journal__summary"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
        >
          {summary}
          <HugeiconsIcon className="journal__chevron" icon={ArrowDown01Icon} size={18} aria-hidden="true" />
        </button>
      ) : (
        <div className="journal__summary">{summary}</div>
      )}

      <div className="journal__tools">
        {entry.discussion_id && (
          <button
            type="button"
            className="journal__icon-button"
            onClick={() => navigate(`/chat/${entry.discussion_id}`)}
            aria-label={t.openDiscussion}
            title={t.openDiscussion}
          >
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={18} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="journal__icon-button journal__icon-button--delete"
          onClick={remove}
          aria-label={t.remove}
          title={t.remove}
        >
          <HugeiconsIcon icon={Delete02Icon} size={18} aria-hidden="true" />
        </button>
      </div>

      {steps.length > 0 && (
        <div className="journal__progress">
          <span className="journal__bar" aria-hidden="true">
            <span style={{ width: `${(done.size / steps.length) * 100}%` }} />
          </span>
          <span className="journal__progress-text">
            {t.plan} · <span>{t.planProgress(done.size, steps.length)}</span>
          </span>
        </div>
      )}

      {entry.status === 'reviewed' && entry.outcome && (
        <div className="journal__result">
          <span className={`journal__chip journal__chip--${entry.outcome}`}>{t.outcomes[entry.outcome]}</span>
          {entry.reflection && <p className="journal__reflection">{entry.reflection}</p>}
        </div>
      )}

      {entry.status === 'due' && !open && (
        <div className={quickAppears ? 'journal__fold' : undefined}>
          <div className="journal__quick">
            <span className="journal__label" id={quickId}>{t.howIsIt}</span>
            <div className="journal__outcomes" role="group" aria-labelledby={quickId}>
              {OUTCOMES.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`journal__outcome journal__outcome--${key}`}
                  onClick={() => {
                    setQuickOutcome(key);
                    setOpen(true);
                  }}
                >
                  {t.outcomes[key]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {hasDetails && open && (
        <div
          id={bodyId}
          className={`journal__fold${closing ? ' journal__fold--closing' : ''}`}
        >
          <div>
            <div className="journal__body">
              {steps.length > 0 && (
                <ul className="journal__steps" aria-label={t.plan}>
                  {steps.map((step, index) => (
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
              )}

              {triggers.length > 0 && (
                <section className="journal__triggers">
                  <h3 className="journal__label">{t.triggers}</h3>
                  <ul>
                    {triggers.map((item, index) => (
                      <li key={`${entry.id}-trigger-${index}`}>
                        <InlineText text={item} sources={NO_SOURCES} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {entry.status !== 'reviewed' && (reviewing ? (
                <ReviewForm entry={entry} initialOutcome={quickOutcome} onSaved={onChange} />
              ) : (
                <button type="button" className="journal__button journal__button--soft" onClick={() => setReviewing(true)}>
                  {t.reviewNow}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
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
      pushToast(value ? t.emailsOnToast : t.emailsOffToast);
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

  const isLoading = !error && entries === null;

  return (
    <main className="history journal">
      <div className="history__scroll" aria-busy={isLoading}>
        <div className="journal__inner">
          <h1 className="history__sr-only">{t.title}</h1>

          {error && (
            <div className="history__error" role="alert">
              <p>{error}</p>
              <button type="button" className="history__retry" onClick={load}>
                {t.retry}
              </button>
            </div>
          )}

          {isLoading && (
            <ul className="journal__list" aria-hidden="true">
              {Array.from({ length: SKELETON_COUNT }, (_, index) => (
                <li key={index} className="journal__entry journal__entry--skeleton">
                  <span className="history__skeleton history__skeleton--date" />
                  <span className="history__skeleton history__skeleton--title" />
                  <span className="history__skeleton history__skeleton--title history__skeleton--short" />
                </li>
              ))}
            </ul>
          )}

          {entries?.length === 0 && (
            <div className="journal__empty">
              <p>{t.empty}</p>
              <button type="button" className="history__retry" onClick={() => navigate('/home')}>
                {t.emptyAction}
              </button>
            </div>
          )}

          {groups.map((group) => (
            <section key={group.key} className="journal__group" aria-labelledby={`journal-${group.key}`}>
              <h2 id={`journal-${group.key}`} className="history__group-title journal__group-title">
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

      {/* панель праворуч, як в історії: листи-нагадування вгорі, нова дискусія внизу */}
      <aside className="history__rail" aria-label={t.toolbar}>
        <div className="history__rail-group">
          {emails !== null && (
            <button
              type="button"
              role="switch"
              aria-checked={emails}
              className={`history__rail-button history__archive${emails ? ' history__archive--active' : ''}`}
              onClick={() => changeEmails(!emails)}
              aria-label={t.emails}
              title={`${t.emails} — ${emails ? t.emailsOn : t.emailsOff}. ${t.emailsHint}`}
            >
              <HugeiconsIcon icon={emails ? Mail01Icon : MailRemove01Icon} size={22} aria-hidden="true" />
            </button>
          )}
        </div>

        <button
          type="button"
          className="history__rail-button history__new"
          onClick={() => navigate('/home')}
          aria-label={copy.history.newDiscussion}
          title={copy.history.newDiscussion}
        >
          <HugeiconsIcon icon={PencilEdit02Icon} size={22} aria-hidden="true" />
        </button>
      </aside>
    </main>
  );
}
