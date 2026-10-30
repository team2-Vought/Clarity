import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updateDecision } from '../api/journal';
import { refreshJournalDue, useJournalDue } from '../hooks/useJournalDue';
import { copy, locale } from '../copy';

const t = copy.journal;
const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });

/** На головній: настав час спитати «Як воно?» про найдавніше рішення з журналу. */
export default function DueDecisionCard() {
  const navigate = useNavigate();
  const { next } = useJournalDue();
  const [busy, setBusy] = useState(false);
  if (!next) return null;

  const later = async () => {
    setBusy(true);
    try {
      await updateDecision(next.id, { remind_in_days: 7 });
      await refreshJournalDue();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="debate__due" aria-labelledby="due-decision-ask">
      <span className="debate__due-label">{t.dueBanner(dateFormat.format(new Date(next.created_at)))}</span>
      <p className="debate__due-decision">«{next.decision}»</p>
      <div className="debate__due-foot">
        <span id="due-decision-ask" className="debate__due-ask">{t.howIsIt}</span>
        <button type="button" className="debate__due-later" onClick={later} disabled={busy}>
          {t.later}
        </button>
        <button
          type="button"
          className="debate__due-tell"
          onClick={() => navigate(`/journal?review=${next.id}`)}
          disabled={busy}
        >
          {t.tell}
        </button>
      </div>
    </section>
  );
}
