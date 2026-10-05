import { useNavigate } from 'react-router-dom';
import PropTypes from 'prop-types';
import Logo from '../components/Logo';
import { uk } from '../copy/uk';

export function Background() {
  return (
    <div className="bg" aria-hidden="true">
      <span className="blob blob--pink" />
      <span className="blob blob--blue" />
      <span className="blob blob--peach" />
      <span className="blob blob--lilac" />
    </div>
  );
}

export function AuthPage({ title, form, variant }) {
  const navigate = useNavigate();
  return (
    <div className="page page--auth">
      <Background />
      <main className="main main--auth">
        <section className={`card card--auth card--${variant}`} aria-labelledby="title">
          <div className="card__logo">
            <Logo onHome={() => navigate('/')} />
          </div>
          <div className="auth-view">
            <h1 id="title">{title}</h1>
            {form}
          </div>
          <p className="card__back">
            <button type="button" className="link" onClick={() => navigate('/')}>
              {uk.common.backHome}
            </button>
          </p>
        </section>
      </main>
      <footer className="footer" />
    </div>
  );
}

AuthPage.propTypes = {
  title: PropTypes.string.isRequired,
  form: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(['login', 'register']).isRequired,
};
