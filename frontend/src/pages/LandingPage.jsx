import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import Landing from '../components/Landing';
import { Background } from './AuthLayout';
import { getSession } from '../api/client';
import { startGuest } from '../api/auth';
import { copy } from '../copy';
import { usePageTitle } from '../hooks/usePageTitle';

// Той самий ключ, що й чернетка питання на головній застосунку:
// введене на лендингу питання чекатиме в полі після входу
const DRAFT_KEY = 'clarity:draft-question';

export default function LandingPage() {
  const navigate = useNavigate();
  usePageTitle(copy.landing.pageTitle, { exact: true });
  const signedIn = Boolean(getSession());
  const [starting, setStarting] = useState(false);

  // Питання з лендингу — одразу дискусія, без реєстрації: сервер впускає гостем
  // (одна дискусія), а зареєструватися можна потім — дискусія перейде в акаунт.
  // Гостьовий режим недоступний (вимкнено, місця закінчились) — ведемо на реєстрацію.
  const start = async (question) => {
    try {
      if (question) localStorage.setItem(DRAFT_KEY, question);
    } catch {
      // без сховища питання доведеться ввести ще раз
    }
    if (signedIn) {
      navigate('/home');
      return;
    }
    if (!question) {
      navigate('/register');
      return;
    }
    setStarting(true);
    try {
      await startGuest();
      navigate('/home', { state: { autostart: true } });
    } catch {
      setStarting(false);
      navigate('/register');
    }
  };

  // Хто вже увійшов, повертаючись на сайт, одразу потрапляє в новий чат,
  // а не на лендинг з кнопкою «Відкрити Clarity»
  if (signedIn && !starting) return <Navigate to="/home" replace />;

  return (
    <div className="page page--landing">
      <Background />
      <Landing
        signedIn={signedIn}
        starting={starting}
        onLogin={() => navigate('/login')}
        onRegister={() => navigate('/register')}
        onHome={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        onStart={start}
      />
    </div>
  );
}
