import { useNavigate } from 'react-router-dom';
import PropTypes from 'prop-types';
import Logo from '../components/Logo';
import { copy } from '../copy';

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

export function AuthPage({ title, form, variant, lead = '' }) {
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
            {lead && <p className="auth-lead">{lead}</p>}
            {form}
          </div>
          <p className="card__back">
            <button type="button" className="link" onClick={() => navigate('/')}>
              {copy.common.backHome}
            </button>
          </p>
        </section>
      </main>
    </div>
  );
}

AuthPage.propTypes = {
  title: PropTypes.string.isRequired,
  form: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(['login', 'register']).isRequired,
  lead: PropTypes.string,
};
