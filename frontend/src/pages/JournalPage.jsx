import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  Book02Icon,
  Delete02Icon,
  Mail01Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { deleteDecision, fetchJournal, updateDecision } from '../api/journal';
import { fetchSettings } from '../api/settings';
import { refreshJournalDue } from '../hooks/useJournalDue';
import { useToasts } from '../hooks/useToasts';
import { InlineText } from '../components/MessageMarkdown';
import { copy, locale } from '../copy';
import LoadError from '../components/LoadError';
import EmptyState from '../components/EmptyState';
import { confirmAction } from '../utils/confirm';
import { describeError } from '../utils/errorKind';
import { usePageTitle } from '../hooks/usePageTitle';

const t = copy.journal;
const OUTCOMES = ['good', 'mixed', 'bad'];
const REFLECTION_MAX = 1000;
const NO_SOURCES = new Map();
const SKELETON_COUNT = 3;
// скільки триває згортання картки й форми «Як воно?» — як анімації в стилях:
// спершу блоки гаснуть знизу вгору, тоді стискається висота
const FOLD_MS = 320;
const REVIEW_CLOSE_MS = 280;

const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });
const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
};

// Поява вмісту картки — як репліки ШІ в чаті: кожен блок зверху вниз
// виринає з розмиття, із затримкою за своїм номером (--item). При закритті
// блоки гаснуть у зворотному порядку — за місцем у картці (--rank)
const reveal = (index, rank = index) => ({ '--item': index, '--rank': rank });

const prefersReducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced'
  || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** «Як воно?»: як вийшло й висновок для себе; «Скасувати» ховає форму назад у кнопку. */
function ReviewForm({ entry, initialOutcome, onSaved, onCancel, revealFrom = 0, rankFrom = 0 }) {
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
    <div className="journal__review journal__reveal" style={reveal(revealFrom, rankFrom)}>
      <span
        className="journal__section-title journal__reveal"
        id={`${id}-outcome`}
        style={reveal(revealFrom + 1, rankFrom + 1)}
      >
        {t.howIsIt}
      </span>
      <div
        className="journal__outcomes journal__reveal"
        role="radiogroup"
        aria-labelledby={`${id}-outcome`}
        style={reveal(revealFrom + 2, rankFrom + 2)}
      >
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
      <label
        className="journal__label journal__reveal"
        htmlFor={`${id}-reflection`}
        style={reveal(revealFrom + 3, rankFrom + 3)}
      >
        {t.reflection}
      </label>
      <textarea
        id={`${id}-reflection`}
        className="journal__textarea journal__reveal"
        style={reveal(revealFrom + 4, rankFrom + 4)}
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
        placeholder={t.reflectionPlaceholder}
        maxLength={REFLECTION_MAX}
        rows={3}
        disabled={busy}
      />
      <div className="journal__actions journal__reveal" style={reveal(revealFrom + 5, rankFrom + 5)}>
        <button type="button" className="journal__button" onClick={onCancel} disabled={busy}>
          {t.cancel}
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
  revealFrom: PropTypes.number,
  rankFrom: PropTypes.number,
  onSaved: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
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
  const expanded = open && !closing;
  // «Як воно?»: форма, форма, що закривається, або кнопка «Підбити підсумок зараз»
  const [review, setReview] = useState(focused || entry.status === 'due' ? 'form' : 'button');
  // як вона з'являється: разом з усією карткою, виростає з кнопки
  // чи (кнопка після «Скасувати») сама по собі, без затримки
  const [reviewEnter, setReviewEnter] = useState('stagger');
  const reviewTimer = useRef(null);
  const [quickOutcome, setQuickOutcome] = useState('');
  const { pushToast } = useToasts();
  const done = new Set(entry.done_steps || []);
  const steps = entry.steps || [];
  const triggers = entry.triggers || [];
  const hasDetails = steps.length > 0 || triggers.length > 0 || entry.status !== 'reviewed';

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);

  useEffect(
    () => () => {
      clearTimeout(closeTimer.current);
      clearTimeout(reviewTimer.current);
    },
    []
  );

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
    if (!(await confirmAction({ text: t.removeConfirm, confirmLabel: copy.common.delete, danger: true }))) return;
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
        // наступного разу форма з'явиться разом з рештою, а не виростатиме окремо
        setReviewEnter('stagger');
      }, FOLD_MS);
    }
  };

  const openReview = () => {
    clearTimeout(reviewTimer.current);
    setReviewEnter('grow');
    setReview('form');
  };

  // «Скасувати»: рядки форми гаснуть знизу вгору, панель стискається до кнопки
  const cancelReview = () => {
    const finish = () => {
      setQuickOutcome('');
      setReviewEnter('alone');
      setReview('button');
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    setReview('closing');
    reviewTimer.current = setTimeout(finish, REVIEW_CLOSE_MS);
  };

  const meta = [t.decidedOn(formatDate(entry.created_at))];
  if (entry.status === 'waiting') meta.push(t.askOn(formatDate(entry.check_at)));
  if (entry.status === 'reviewed') meta.push(t.reviewedOn(formatDate(entry.reviewed_at)));
  // колір крапки: чекає підсумку, ще рано або як вийшло
  const dot = entry.status === 'reviewed' ? entry.outcome || 'reviewed' : entry.status;

  const allDone = steps.length > 0 && done.size === steps.length;
  // номери блоків для появи: заголовок плану, кроки, заголовок «коли передумати», пункти, «Як воно?»
  const triggersFrom = steps.length > 0 ? steps.length + 1 : 0;
  const reviewFrom = triggersFrom + (triggers.length > 0 ? triggers.length + 1 : 0);
  // останнє місце в картці: форма — це шість блоків, кнопка — один
  const lastRank = entry.status === 'reviewed' ? reviewFrom - 1 : review === 'button' ? reviewFrom : reviewFrom + 5;

  // скільки кроків зроблено: у згорнутій картці — під питанням, у розгорнутій — біля заголовка плану
  const progress = (
    <span className={`journal__progress${allDone ? ' journal__progress--done' : ''}`}>
      <span className="journal__bar" aria-hidden="true">
        <span style={{ width: `${(done.size / Math.max(1, steps.length)) * 100}%` }} />
      </span>
      <span className="journal__progress-text">{t.planProgress(done.size, steps.length)}</span>
    </span>
  );

  const summary = (
    <>
      <span className="journal__when">
        <span className={`journal__dot journal__dot--${dot}`} aria-hidden="true" />
        {meta.join(' · ')}
      </span>
      <span className="journal__decision">{entry.decision}</span>
      <span className="journal__question" title={entry.question}>{entry.question}</span>
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

      {/* у розгорнутій картці прогрес переїжджає до заголовка плану */}
      {steps.length > 0 && (
        <div className={`journal__collapse${expanded ? ' journal__collapse--shut' : ''}`} inert={expanded}>
          <div className="journal__overview">
            <span className="journal__overview-label">{t.plan}</span>
            {progress}
          </div>
        </div>
      )}

      {entry.status === 'reviewed' && entry.outcome && (
        <div className="journal__result">
          <span className={`journal__chip journal__chip--${entry.outcome}`}>{t.outcomes[entry.outcome]}</span>
          {entry.reflection && <p className="journal__reflection">{entry.reflection}</p>}
        </div>
      )}

      {/* ховається разом із розгортанням і повертається, поки картка згортається */}
      {entry.status === 'due' && (
        <div className={`journal__collapse${expanded ? ' journal__collapse--shut' : ''}`} inert={expanded}>
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
          style={{ '--count': lastRank }}
        >
          <div>
            <div className="journal__body">
              {steps.length > 0 && (
                <section className="journal__section" aria-labelledby={`${bodyId}-plan`}>
                  <div className="journal__section-head journal__reveal" style={reveal(0)}>
                    <h3 className="journal__section-title" id={`${bodyId}-plan`}>{t.plan}</h3>
                    {progress}
                  </div>
                  <ul className="journal__steps">
                    {steps.map((step, index) => (
                      <li key={`${entry.id}-${index}`} className="journal__reveal" style={reveal(index + 1)}>
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

              {triggers.length > 0 && (
                <section className="journal__section" aria-labelledby={`${bodyId}-triggers`}>
                  <h3
                    className="journal__section-title journal__reveal"
                    id={`${bodyId}-triggers`}
                    style={reveal(triggersFrom)}
                  >
                    {t.triggers}
                  </h3>
                  <ul className="journal__triggers">
                    {triggers.map((item, index) => (
                      <li
                        key={`${entry.id}-trigger-${index}`}
                        className="journal__reveal"
                        style={reveal(triggersFrom + index + 1)}
                      >
                        <InlineText text={item} sources={NO_SOURCES} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {entry.status !== 'reviewed' && (review === 'button' ? (
                <button
                  type="button"
                  className="journal__button journal__button--soft journal__reveal"
                  style={reveal(reviewEnter === 'stagger' ? reviewFrom : 0, reviewFrom)}
                  onClick={openReview}
                >
                  {t.reviewNow}
                </button>
              ) : (
                <div
                  className={[
                    'journal__swap',
                    review === 'form' && reviewEnter === 'grow' && 'journal__swap--grow',
                    review === 'closing' && 'journal__swap--shrink',
                  ].filter(Boolean).join(' ')}
                  style={{ '--count': reviewFrom + 5 }}
                  inert={review === 'closing'}
                >
                  <div>
                    <ReviewForm
                      entry={entry}
                      initialOutcome={quickOutcome}
                      onSaved={onChange}
                      onCancel={cancelReview}
                      revealFrom={reviewEnter === 'stagger' ? reviewFrom : 0}
                      rankFrom={reviewFrom}
                    />
                  </div>
                </div>
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
  // { kind, text } або null
  const [error, setError] = useState(null);
  const [emails, setEmails] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchJournal();
      setEntries(data.results || []);
    } catch (err) {
      setError(describeError(err, t.loadError));
    }
    fetchSettings()
      .then((data) => setEmails(data?.preferences?.journal_emails !== false))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  usePageTitle(t.title);

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

          {error && <LoadError kind={error.kind} text={error.text} onRetry={load} />}

          {/* скелет повторює розкладку групи разом із заголовком — інакше картки
              після завантаження з'їжджали б униз на висоту заголовка */}
          {isLoading && (
            <div className="journal__group" aria-hidden="true">
              <span className="history__skeleton journal__skeleton-title" />
              <ul className="journal__list">
                {Array.from({ length: SKELETON_COUNT }, (_, index) => (
                  <li key={index} className="journal__entry journal__entry--skeleton">
                    <span className="history__skeleton history__skeleton--date" />
                    <span className="history__skeleton history__skeleton--title" />
                    <span className="history__skeleton history__skeleton--title history__skeleton--short" />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {entries?.length === 0 && (
            <EmptyState
              page
              icon={Book02Icon}
              title={t.emptyTitle}
              text={t.empty}
              action={{ label: t.emptyAction, onClick: () => navigate('/home') }}
            />
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
          {/* листи вмикають у налаштуваннях; тут — лише нагадка, що вони є */}
          {emails !== null && entries?.length > 0 && (
            <p className="journal__emails">
              <HugeiconsIcon icon={Mail01Icon} size={16} aria-hidden="true" />
              <span>{emails ? t.emailsOnNote : t.emailsOffNote}</span>
              <Link to="/settings?tab=notifications">{t.emailsSettings}</Link>
            </p>
          )}
        </div>
      </div>

      {/* панель праворуч, як в історії: нова дискусія внизу */}
      <aside className="history__rail" aria-label={t.toolbar}>
        {/* верхня група порожня — кнопка нової дискусії лишається внизу, як в історії */}
        <div className="history__rail-group" />

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
