import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Logo from './Logo';
import Hero from './landing/Hero';
import HowItWorks from './landing/HowItWorks';
import Team from './landing/Team';
import LiveDemo from './landing/LiveDemo';
import Features from './landing/Features';
import { useDeviceTheme } from '../hooks/useDeviceTheme';
import PublicFooter from './PublicFooter';
import { copy } from '../copy';

const t = copy.landing;
const NAV = ['how', 'team', 'demo', 'features'];
export default function Landing({ signedIn, onLogin, onRegister, onHome, onStart }) {
  // лендинг завжди в темі пристрою, а не в тій, що обрана в застосунку
  useDeviceTheme();
  const [question, setQuestion] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const rootRef = useRef(null);

  // блоки з data-reveal плавно з'являються, коли доходять до екрана
  useEffect(() => {
    const items = rootRef.current?.querySelectorAll('[data-reveal]') ?? [];
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const primaryLabel = signedIn ? t.openApp : t.register;
  const start = () => onStart(question.trim());

  return (
    <div className="lp" ref={rootRef}>
      <header className={`lp-header${scrolled ? ' lp-header--scrolled' : ''}`}>
        <div className="lp-header__brand">
          <Logo onHome={onHome} wordmark />
        </div>
        <nav className="lp-header__nav" aria-label={t.navLabel}>
          {NAV.map((key) => (
            <a key={key} href={`#${key}`}>
              {t.nav[key]}
            </a>
          ))}
        </nav>
        <div className="lp-header__actions">
          {!signedIn && (
            <button type="button" className="btn-ghost lp-header__login" onClick={onLogin}>
              {t.login}
            </button>
          )}
          <button type="button" className="btn btn--sm" onClick={signedIn ? start : onRegister}>
            {primaryLabel}
          </button>
        </div>
      </header>

      <main className="lp-main">
        <Hero onStart={onStart} question={question} onQuestionChange={setQuestion} />
        <HowItWorks />
        <Team />
        <LiveDemo />
        <Features />

        <section className="lp-cta" aria-labelledby="cta-title" data-reveal>
          <h2 id="cta-title" className="lp-cta__title">
            {t.ctaTitle}
          </h2>
          <p className="lp-cta__text">{signedIn ? t.ctaTextSignedIn : t.ctaText}</p>
          <div className="lp-cta__actions">
            <button type="button" className="btn" onClick={signedIn ? start : onRegister}>
              {primaryLabel}
            </button>
            {!signedIn && (
              <button type="button" className="btn-ghost btn-ghost--bordered" onClick={onLogin}>
                {t.login}
              </button>
            )}
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}

Landing.propTypes = {
  signedIn: PropTypes.bool,
  onLogin: PropTypes.func.isRequired,
  onRegister: PropTypes.func.isRequired,
  onHome: PropTypes.func,
  onStart: PropTypes.func.isRequired,
};
