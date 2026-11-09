import { useState } from 'react';
import { resendVerification } from '../api/auth';
import { useMyProfile } from '../hooks/useMyProfile';
import { copy } from '../copy';

const t = copy.verifyEmail;

/** На головній: пошту ще не підтверджено, тож дискусії не стартують — нагадуємо й даємо надіслати лист знову. */
export default function VerifyEmailCard() {
  const { verificationRequired, email } = useMyProfile();
  // 'idle' | 'busy' | 'sent' | текст помилки
  const [state, setState] = useState('idle');
  if (!verificationRequired) return null;

  const resend = async () => {
    setState('busy');
    try {
      await resendVerification();
      setState('sent');
    } catch (err) {
      setState(err?.message || copy.errors.unexpected);
    }
  };

  const message = state === 'sent' ? t.sent : state !== 'idle' && state !== 'busy' ? state : '';
  return (
    <section className="debate__due debate__due--verify" aria-labelledby="verify-email-title">
      <span id="verify-email-title" className="debate__due-label">{t.bannerTitle}</span>
      <p className="debate__due-text">{t.bannerText(email)}</p>
      <div className="debate__due-foot">
        <span className="debate__due-ask" role="status">{message}</span>
        <button
          type="button"
          className="debate__due-tell"
          onClick={resend}
          disabled={state === 'busy' || state === 'sent'}
        >
          {state === 'busy' ? t.resending : t.resend}
        </button>
      </div>
    </section>
  );
}
