import { Navigate, useNavigate } from 'react-router-dom';
import Landing from '../components/Landing';
import { Background } from './AuthLayout';
import { getSession } from '../api/client';
import { copy } from '../copy';
import { usePageTitle } from '../hooks/usePageTitle';

// Той самий ключ, що й чернетка питання на головній застосунку:
// введене на лендингу питання чекатиме в полі після входу
const DRAFT_KEY = 'clarity:draft-question';

export default function LandingPage() {
  const navigate = useNavigate();
  usePageTitle(copy.landing.pageTitle, { exact: true });
  const signedIn = Boolean(getSession());

  const start = (question) => {
    try {
      if (question) localStorage.setItem(DRAFT_KEY, question);
    } catch {
      // без сховища просто відкриємо реєстрацію
    }
    navigate(signedIn ? '/home' : '/register');
  };

  // Хто вже увійшов, повертаючись на сайт, одразу потрапляє в новий чат,
  // а не на лендинг з кнопкою «Відкрити Clarity»
  if (signedIn) return <Navigate to="/home" replace />;

  return (
    <div className="page page--landing">
      <Background />
      <Landing
        signedIn={signedIn}
        onLogin={() => navigate('/login')}
        onRegister={() => navigate('/register')}
        onHome={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        onStart={start}
      />
    </div>
  );
}
