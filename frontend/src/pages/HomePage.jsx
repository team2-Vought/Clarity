import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Background } from './AuthLayout';
import { logout, me } from '../api/auth';
import { getToken } from '../api/client';
import { uk } from '../copy/uk';

const t = uk.home;

export default function HomePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      navigate('/login', { replace: true });
      return;
    }
    let alive = true;
    me()
      .then((data) => {
        if (alive) setUser(data);
      })
      .catch(() => {
        if (!alive) return;
        setError(t.unauthorized);
        setTimeout(() => navigate('/login', { replace: true }), 1200);
      });
    return () => {
      alive = false;
    };
  }, [navigate]);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="page page--auth">
      <Background />
      <main className="main main--auth">
        <section className="card card--auth" aria-labelledby="home-title">
          <h1 id="home-title">{t.title}</h1>
          {user ? (
            <>
              <p className="hero__text">{t.hello(user.name)}</p>
              <p className="hero__text">{t.email(user.email)}</p>
            </>
          ) : (
            <p className="hero__text" role="status">
              {error || t.loading}
            </p>
          )}
          <p className="hero__text">{t.stub}</p>
          <button className="btn" type="button" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? t.loggingOut : t.logout}
          </button>
        </section>
      </main>
    </div>
  );
}
