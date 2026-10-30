import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, Notification03Icon } from '@hugeicons/core-free-icons';
import { useNotifyPrefs } from '../../hooks/useNotifyPrefs';
import { readNotifyAsked, writeNotifyAsked } from '../../utils/notify';
import { copy } from '../../copy';

const t = copy.notify;

/**
 * Поки AI думають, пропонує сповістити, коли висновок буде готовий. Дозвіл
 * браузер дає лише у відповідь на дію людини — тому це кнопка, а не
 * запит при відкритті сторінки. Після відповіді більше не з'являється.
 */
export default function NotifyOffer() {
  const { system, permission, setSystem } = useNotifyPrefs();
  const [answered, setAnswered] = useState(readNotifyAsked);
  const canOffer = permission === 'default' || (permission === 'granted' && !system);
  if (answered || !canOffer) return null;

  const answer = (enable) => {
    writeNotifyAsked();
    setAnswered(true);
    if (enable) setSystem(true);
  };

  return (
    <div className="chat__notify-offer">
      <button type="button" className="chat__notify-offer-action" onClick={() => answer(true)}>
        <HugeiconsIcon icon={Notification03Icon} size={16} aria-hidden="true" />
        <span className="chat__notify-offer-text">
          <span className="chat__notify-offer-title">{t.ask}</span>
          <span className="chat__notify-offer-hint">{t.askHint}</span>
        </span>
      </button>
      <button
        type="button"
        className="chat__notify-offer-close"
        onClick={() => answer(false)}
        aria-label={t.dismiss}
        title={t.dismiss}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
