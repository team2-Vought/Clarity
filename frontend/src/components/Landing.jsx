import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons';
import Logo from './Logo';
import Hero from './landing/Hero';
import HowItWorks from './landing/HowItWorks';
import Team from './landing/Team';
import LiveDemo from './landing/LiveDemo';
import Features from './landing/Features';
import { writeThemeMode } from '../utils/devicePrefs';
import { uk } from '../copy/uk';

const t = uk.landing;
const NAV = ['how', 'team', 'demo', 'features'];

const readTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

export default function Landing({ signedIn, onLogin, onRegister, onHome, onStart }) {
  const [theme, setTheme] = useState(readTheme);
  const [question, setQuestion] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const rootRef = useRef(null);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === 'dark' ? '#121212' : '#ececec';
    writeThemeMode(next);
    setTheme(next);
  };

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

  // приклад із бігучого рядка підставляється в поле питання вгорі
  const pickExample = (text) => {
    setQuestion(text);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('lp-ask-input')?.focus({ preventScroll: true });
  };

  const primaryLabel = signedIn ? t.openApp : t.register;
  const start = () => onStart(question.trim());

  return (
    <div className="lp" ref={rootRef}>
      <header className={`lp-header${scrolled ? ' lp-header--scrolled' : ''}`}>
        <Logo onHome={onHome} />
        <nav className="lp-header__nav" aria-label={t.navLabel}>
          {NAV.map((key) => (
            <a key={key} href={`#${key}`}>
              {t.nav[key]}
            </a>
          ))}
        </nav>
        <div className="lp-header__actions">
          <button
            type="button"
            className="lp-icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t.themeLight : t.themeDark}
            title={theme === 'dark' ? t.themeLight : t.themeDark}
          >
            <HugeiconsIcon icon={theme === 'dark' ? Sun03Icon : Moon02Icon} size={19} strokeWidth={1.8} />
          </button>
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

        <section className="lp-marquee" aria-label={t.marqueeLabel}>
          <p className="lp-marquee__label">{t.marqueeLabel}</p>
          <div className="lp-marquee__track">
            {/* друга копія — для безшовної прокрутки; для скрінрідерів її не існує */}
            {[0, 1].map((copy) => (
              <ul key={copy} className="lp-marquee__list" aria-hidden={copy === 1}>
                {t.marquee.map((q) => (
                  <li key={q}>
                    <button type="button" tabIndex={copy === 1 ? -1 : 0} onClick={() => pickExample(q)}>
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </section>

        <HowItWorks />
        <Team />
        <LiveDemo />
        <Features theme={theme} onToggleTheme={toggleTheme} />

        <section className="lp-cta" aria-labelledby="cta-title" data-reveal>
          <div className="lp-cta__glow" aria-hidden="true" />
          <h2 id="cta-title" className="lp-cta__title">
            {t.ctaTitle}
          </h2>
          <p className="lp-cta__text">{t.ctaText}</p>
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

      <footer className="lp-footer">
        <Logo onHome={onHome} />
        <span>{t.footer}</span>
      </footer>
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
