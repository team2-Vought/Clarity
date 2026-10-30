import { useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ThumbsDownIcon, ThumbsUpIcon } from '@hugeicons/core-free-icons';
import { sendFeedback } from '../../api/discussions';
import { useToasts } from '../../hooks/useToasts';
import { copy } from '../../copy';

const t = copy.chat;

/** «Допомогло / не допомогло» під висновком; «не допомогло» питає, що було не так. */
export default function FeedbackBar({ discussionId, initial = '', initialNote = '' }) {
  const [value, setValue] = useState(initial);
  const [note, setNote] = useState(initialNote);
  // після «не допомогло» відкривається поле «що не так»; надіслане — ховається
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const { pushToast } = useToasts();

  const save = async (next, nextNote = '') => {
    setBusy(true);
    try {
      const data = await sendFeedback(discussionId, next, nextNote);
      setValue(data.feedback);
      setNote(data.feedback_note);
      return true;
    } catch (err) {
      pushToast(err?.message || t.feedbackError);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const choose = async (next) => {
    if (await save(next)) setAsking(next === 'not_helped');
  };

  if (value && !asking) {
    return (
      <div className="chat__feedback chat__feedback--done">
        <span>{t.feedbackThanks}</span>
        <button type="button" className="chat__feedback-change" onClick={() => setValue('')}>
          {t.feedbackChange}
        </button>
      </div>
    );
  }

  return (
    <div className="chat__feedback">
      <div className="chat__feedback-row">
        <span className="chat__feedback-ask">{t.feedbackAsk}</span>
        {[
          ['helped', ThumbsUpIcon, t.feedbackHelped],
          ['not_helped', ThumbsDownIcon, t.feedbackNotHelped],
        ].map(([key, icon, label]) => (
          <button
            key={key}
            type="button"
            className={`chat__feedback-button ${value === key ? 'chat__feedback-button--active' : ''}`}
            onClick={() => choose(key)}
            aria-pressed={value === key}
            disabled={busy}
          >
            <HugeiconsIcon icon={icon} size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {asking && (
        <form
          className="chat__feedback-why"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await save('not_helped', note.trim())) setAsking(false);
          }}
        >
          <label className="chat__feedback-ask" htmlFor={`feedback-${discussionId}`}>{t.feedbackWhy}</label>
          <div className="chat__feedback-why-row">
            <input
              id={`feedback-${discussionId}`}
              className="chat__feedback-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.feedbackWhyPlaceholder}
              maxLength={500}
              disabled={busy}
            />
            <button type="submit" className="chat__feedback-send" disabled={busy || !note.trim()}>
              {t.feedbackSend}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

FeedbackBar.propTypes = {
  discussionId: PropTypes.string.isRequired,
  initial: PropTypes.string,
  initialNote: PropTypes.string,
};
