import { useNavigate } from 'react-router-dom';
import { Background } from './AuthLayout';
import { copy } from '../copy';

export default function AccountPage() {
  const navigate = useNavigate();
  return (
    <div className="page page--auth">
      <Background />
      <main className="main main--auth">
        <section className="card card--auth" aria-labelledby="account-title">
          <h1 id="account-title">{copy.account.title}</h1>
          <p className="hero__text">{copy.account.empty}</p>
          <button className="btn" type="button" onClick={() => navigate('/')}>
            {copy.common.backHome}
          </button>
        </section>
      </main>
    </div>
  );
}
