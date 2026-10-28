import { useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AiBrain01Icon,
  Download01Icon,
  GlobalSearchIcon,
  Link01Icon,
  Moon02Icon,
  Pdf01Icon,
  Sun03Icon,
} from '@hugeicons/core-free-icons';
import Shot from './Shot';
import { uk } from '../../copy/uk';

const t = uk.landing;
const SHARE_ICONS = [Link01Icon, Pdf01Icon, Download01Icon];

export default function Features({ theme, onToggleTheme }) {
  const [mode, setMode] = useState(t.modes.items[0].key);
  const activeMode = t.modes.items.find((m) => m.key === mode);

  return (
    <section className="lp-section lp-features" id="features" aria-labelledby="features-title">
      <header className="lp-section__head" data-reveal>
        <p className="lp-eyebrow">{t.featuresEyebrow}</p>
        <h2 id="features-title" className="lp-section__title">
          {t.featuresTitle}
        </h2>
      </header>

      <div className="lp-bento">
        <article className="lp-tile lp-tile--models" data-reveal>
          <span className="lp-tile__icon">
            <HugeiconsIcon icon={AiBrain01Icon} size={22} strokeWidth={1.7} />
          </span>
          <h3>{t.models.title}</h3>
          <p>{t.models.text}</p>
          <ul className="lp-chips">
            {t.models.list.map((name, i) => (
              <li key={name} style={{ '--i': i }}>
                {name}
              </li>
            ))}
          </ul>
        </article>

        <article className="lp-tile lp-tile--search" data-reveal>
          <span className="lp-tile__icon">
            <HugeiconsIcon icon={GlobalSearchIcon} size={22} strokeWidth={1.7} />
          </span>
          <h3>{t.search.title}</h3>
          <p>{t.search.text}</p>
          <div className="lp-search" aria-hidden="true">
            <span className="lp-search__query">
              <HugeiconsIcon icon={GlobalSearchIcon} size={15} strokeWidth={1.8} />
              <span className="lp-search__typed">{t.search.query}</span>
            </span>
            <span className="lp-search__sources">
              {[1, 2, 3, 4].map((n) => (
                <span key={n} style={{ '--i': n }}>
                  [{n}]
                </span>
              ))}
            </span>
          </div>
        </article>

        <article className="lp-tile lp-tile--modes" data-reveal>
          <h3>{t.modes.title}</h3>
          <div className="lp-segment" role="radiogroup" aria-label={t.modes.title}>
            {t.modes.items.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={mode === m.key}
                className={mode === m.key ? 'is-active' : ''}
                onClick={() => setMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p key={mode} className="lp-segment__hint">
            {activeMode.hint}
          </p>
        </article>

        <article className="lp-tile lp-tile--theme" data-reveal>
          <h3>{t.theme.title}</h3>
          <p>{t.theme.text}</p>
          <button
            type="button"
            className="lp-switch"
            role="switch"
            aria-checked={theme === 'dark'}
            aria-label={theme === 'dark' ? t.themeLight : t.themeDark}
            onClick={onToggleTheme}
          >
            <span className="lp-switch__knob">
              <HugeiconsIcon icon={theme === 'dark' ? Moon02Icon : Sun03Icon} size={18} strokeWidth={1.9} />
            </span>
          </button>
        </article>

        <article className="lp-tile lp-tile--share" data-reveal>
          <h3>{t.share.title}</h3>
          <p>{t.share.text}</p>
          <ul className="lp-share">
            {t.share.items.map((item, i) => (
              <li key={item}>
                <HugeiconsIcon icon={SHARE_ICONS[i]} size={16} strokeWidth={1.8} />
                {item}
              </li>
            ))}
          </ul>
        </article>

        <article className="lp-tile lp-tile--history" data-reveal>
          <div className="lp-tile__copy">
            <h3>{t.history.title}</h3>
            <p>{t.history.text}</p>
          </div>
          <div className="lp-tile__shot">
            <Shot name="history" alt={t.history.alt} />
          </div>
        </article>

        <article className="lp-tile lp-tile--mobile" data-reveal>
          <div className="lp-tile__copy">
            <h3>{t.mobile.title}</h3>
            <p>{t.mobile.text}</p>
          </div>
          <div className="lp-phone">
            <Shot name="mobile" alt={t.mobile.alt} width={1170} height={2532} />
          </div>
        </article>
      </div>
    </section>
  );
}

Features.propTypes = {
  theme: PropTypes.oneOf(['light', 'dark']).isRequired,
  onToggleTheme: PropTypes.func.isRequired,
};
