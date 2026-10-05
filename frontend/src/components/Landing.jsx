import PropTypes from 'prop-types';
import Logo from './Logo';
import { uk } from '../copy/uk';

const t = uk.landing;

export default function Landing({ onLogin, onRegister, onHome }) {
  return (
    <div className="landing">
      <header className="landing__header">
        <Logo onHome={onHome} />
        <nav className="landing__nav" aria-label={t.navLabel}>
          <button type="button" className="btn-ghost" onClick={onLogin}>
            {t.login}
          </button>
          <button type="button" className="btn btn--sm" onClick={onRegister}>
            {t.register}
          </button>
        </nav>
      </header>

      <main className="landing__main">
        <section className="hero" aria-labelledby="landing-title">
          <h1 id="landing-title" className="hero__title">
            {t.title}
          </h1>
          <p className="hero__text">{t.text}</p>
          <div className="hero__actions">
            <button type="button" className="btn" onClick={onRegister}>
              {t.register}
            </button>
            <button type="button" className="btn-ghost btn-ghost--bordered" onClick={onLogin}>
              {t.login}
            </button>
          </div>
        </section>

        <section className="features" aria-label={t.blocksLabel}>
          {t.features.map((f) => (
            <article className="feature" key={f.title}>
              <h2>{f.title}</h2>
              <p>{f.text}</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="landing__footer">
        <span>{t.footer}</span>
      </footer>
    </div>
  );
}

Landing.propTypes = {
  onLogin: PropTypes.func,
  onRegister: PropTypes.func,
  onHome: PropTypes.func,
};
