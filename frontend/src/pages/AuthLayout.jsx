import { Link, useNavigate } from 'react-router-dom';
import PropTypes from 'prop-types';
import Logo from '../components/Logo';
import { VisionTrigger } from '../components/VisionDialog';
import { copy } from '../copy';
import { useDeviceTheme } from '../hooks/useDeviceTheme';
import { openBugReport } from '../utils/bugReport';
import { usePageTitle } from '../hooks/usePageTitle';

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
  // вхід і реєстрація — у темі пристрою, як і лендинг
  useDeviceTheme();
  usePageTitle(title);
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
          {/* один рядок дрібних посилань замість стовпчика кнопок під формою;
              проблеми зі входом — найчастіша причина написати нам */}
          <nav className="card__meta" aria-label={copy.landing.footerNav}>
            <button type="button" onClick={() => navigate('/')}>
              {copy.common.backHome}
            </button>
            <VisionTrigger className="card__meta-vision" />
            <Link to="/privacy">{copy.landing.privacy}</Link>
            <Link to="/terms">{copy.landing.terms}</Link>
            <button type="button" onClick={() => openBugReport()}>
              {copy.report.trigger}
            </button>
          </nav>
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
