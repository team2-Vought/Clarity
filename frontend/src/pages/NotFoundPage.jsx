import { useNavigate } from 'react-router-dom';
import { Background } from './AuthLayout';
import { uk } from '../copy/uk';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="page page--auth">
      <Background />
      <main className="main main--auth">
        <section className="card card--auth" aria-labelledby="not-found-title">
          <h1 id="not-found-title">Сторінку не знайдено</h1>
          <button className="btn" type="button" onClick={() => navigate('/')}>
            {uk.common.backHome}
          </button>
        </section>
      </main>
    </div>
  );
}
