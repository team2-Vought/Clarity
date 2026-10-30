import { useEffect, useId, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { recordDecision } from '../../api/journal';
import { refreshJournalDue } from '../../hooks/useJournalDue';
import { useToasts } from '../../hooks/useToasts';
import { copy, locale } from '../../copy';
import { inlinePlain } from '../../utils/markdown';

const t = copy.chat;
const REMIND_DAYS = [7, 30, 90];
const DECISION_MAX = 2000;
// у поле підставляється коротке рішення — далі людина допише своїми словами
const PREFILL_MAX = 280;

const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const prefill = (summary) => {
  // відповідь «так» / «ні» йде першим реченням: «Так. Переїжджати варто…»
  const answer = summary?.answer ? `${capitalize(inlinePlain(String(summary.answer)))}. ` : '';
  const decision = inlinePlain(String(summary?.decision || '')).replace(/\s+/g, ' ').trim();
  const text = `${answer}${decision}`.trim();
  if (text.length <= PREFILL_MAX) return text;
  const cut = text.slice(0, PREFILL_MAX);
  const sentence = cut.lastIndexOf('. ');
  return sentence > 80 ? cut.slice(0, sentence + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
};

/**
 * Під висновком: записати рішення в журнал, щоб згодом Clarity спитала «Як воно?».
 * Уже записане — коротко показує, коли спитаємо, і веде в журнал.
 */
export default function JournalCard({ discussion }) {
  const id = useId();
  const navigate = useNavigate();
  const { pushToast } = useToasts();
  const [entry, setEntry] = useState(discussion.journal || null);
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState(() => prefill(discussion.final_summary));
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null);

  // форма розкривається внизу чату — доводимо її в поле зору, над полем вводу
  useEffect(() => {
    if (!open) return;
    const reduced = document.documentElement.dataset.motion === 'reduced'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    formRef.current?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    formRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
  }, [open]);

  if (entry) {
    const reviewed = entry.status === 'reviewed';
    return (
      <div className="chat__journal chat__journal--saved">
        <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden="true" />
        <span>{reviewed ? t.journalReviewed : t.journalSaved(dateFormat.format(new Date(entry.check_at)))}</span>
        <button type="button" className="chat__journal-link" onClick={() => navigate('/journal')}>
          {t.journalOpen}
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="chat__journal chat__journal--offer" onClick={() => setOpen(true)}>
        <span className="chat__journal-text">
          <span className="chat__journal-title">{t.journalTitle}</span>
          <span className="chat__journal-lead">{t.journalLead}</span>
        </span>
        <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
      </button>
    );
  }

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await recordDecision({
        discussion: discussion.id,
        decision: decision.trim(),
        remindInDays: days,
      });
      setEntry({ id: saved.id, check_at: saved.check_at, status: saved.status });
      refreshJournalDue();
    } catch (err) {
      pushToast(err?.fieldErrors?.().decision || err?.message || t.journalError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} className="chat__journal chat__journal--form" onSubmit={save}>
      <label className="chat__journal-title" htmlFor={`${id}-decision`}>{t.journalDecision}</label>
      <textarea
        id={`${id}-decision`}
        className="chat__journal-input"
        value={decision}
        onChange={(e) => setDecision(e.target.value)}
        maxLength={DECISION_MAX}
        rows={3}
        disabled={busy}
      />
      <span className="chat__journal-lead" id={`${id}-remind`}>{t.journalRemind}</span>
      <div className="chat__journal-pills" role="radiogroup" aria-labelledby={`${id}-remind`}>
        {REMIND_DAYS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={days === value}
            className={`chat__journal-pill ${days === value ? 'chat__journal-pill--active' : ''}`}
            onClick={() => setDays(value)}
            disabled={busy}
          >
            {t.journalRemindOptions[value]}
          </button>
        ))}
      </div>
      <button type="submit" className="chat__journal-save" disabled={busy || !decision.trim()}>
        {busy ? t.journalSaving : t.journalSave}
      </button>
    </form>
  );
}

JournalCard.propTypes = {
  discussion: PropTypes.shape({
    id: PropTypes.string.isRequired,
    final_summary: PropTypes.object,
    journal: PropTypes.shape({
      id: PropTypes.string,
      check_at: PropTypes.string,
      status: PropTypes.string,
    }),
  }).isRequired,
};
