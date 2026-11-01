import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import { confirmEmailChange } from '../api/auth';
import { getSession } from '../api/client';
import { copy } from '../copy';

const t = copy.confirmEmail;
// посилання одноразове: повторний запит (StrictMode, повернення назад) не має «спалити» його
const attempts = new Map();
const confirmOnce = (token) => {
  if (!attempts.has(token)) attempts.set(token, confirmEmailChange(token));
  return attempts.get(token);
};

/** Посилання з листа про нову пошту: пошта змінюється лише тут. */
export default function ConfirmEmailPage() {
  const navigate = useNavigate();
  const { token = '' } = useParams();
  // 'checking' | { email } | { error }
  const [result, setResult] = useState('checking');

  useEffect(() => {
    let cancelled = false;
    confirmOnce(token)
      .then((data) => !cancelled && setResult({ email: data?.email || '' }))
      .catch((err) => !cancelled && setResult({ error: err?.message || t.invalid }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (result === 'checking') {
    return <AuthPage title={t.title} lead={t.checking} variant="login" form={<div />} />;
  }

  const signedIn = Boolean(getSession());
  const next = signedIn ? '/settings' : '/login';
  return (
    <AuthPage
      title={result.email ? t.doneTitle : t.invalidTitle}
      lead={result.email ? t.done(result.email) : result.error}
      variant="login"
      form={
        <div className="form">
          <button className="btn" type="button" onClick={() => navigate(next, { replace: true })}>
            {signedIn ? t.toSettings : t.toLogin}
          </button>
        </div>
      }
    />
  );
}
