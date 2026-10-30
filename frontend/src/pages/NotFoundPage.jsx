import { useNavigate } from 'react-router-dom';
import { Background } from './AuthLayout';
import { copy } from '../copy';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="page page--auth">
      <Background />
      <main className="main main--auth">
        <section className="card card--auth" aria-labelledby="not-found-title">
          <h1 id="not-found-title">{copy.common.notFound}</h1>
          <button className="btn" type="button" onClick={() => navigate('/')}>
            {copy.common.backHome}
          </button>
        </section>
      </main>
    </div>
  );
}
