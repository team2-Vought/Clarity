import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import { verifyEmail } from '../api/auth';
import { getSession } from '../api/client';
import { refreshMyProfile } from '../hooks/useMyProfile';
import { copy } from '../copy';

const t = copy.verifyEmail;
// повторний запит (StrictMode, повернення назад) не має показати «посилання не діє»
const attempts = new Map();
const verifyOnce = (token) => {
  if (!attempts.has(token)) attempts.set(token, verifyEmail(token));
  return attempts.get(token);
};

/** Посилання з листа після реєстрації: підтверджує пошту, після чого можна запускати дискусії. */
export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const { token = '' } = useParams();
  // 'checking' | { email } | { error }
  const [result, setResult] = useState('checking');

  useEffect(() => {
    let cancelled = false;
    verifyOnce(token)
      .then((data) => {
        if (cancelled) return;
        setResult({ email: data?.email || '' });
        refreshMyProfile();
      })
      .catch((err) => !cancelled && setResult({ error: err?.message || t.invalidTitle }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (result === 'checking') {
    return <AuthPage title={t.title} lead={t.checking} variant="login" form={<div />} />;
  }

  const signedIn = Boolean(getSession());
  return (
    <AuthPage
      title={result.email ? t.doneTitle : t.invalidTitle}
      lead={result.email ? t.done(result.email) : result.error}
      variant="login"
      form={
        <div className="form">
          <button
            className="btn"
            type="button"
            onClick={() => navigate(signedIn ? '/home' : '/login', { replace: true })}
          >
            {signedIn ? t.toApp : t.toLogin}
          </button>
        </div>
      }
    />
  );
}
