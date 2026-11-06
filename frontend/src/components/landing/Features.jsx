import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AiBrain01Icon, BookOpen01Icon, GlobalSearchIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import Shot from './Shot';
import { copy } from '../../copy';

const t = copy.landing;

export default function Features() {
  const [mode, setMode] = useState(t.modes.items[0].key);
  const activeMode = t.modes.items.find((m) => m.key === mode);

  return (
    <section className="lp-section lp-features" id="features" aria-labelledby="features-title">
      <header className="lp-section__head" data-reveal>
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
            {t.models.list.map((name) => (
              <li key={name}>{name}</li>
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
        <article className="lp-tile lp-tile--tree" data-reveal>
          <div className="lp-tile__copy">
            <h3>{t.tree.title}</h3>
            <p>{t.tree.text}</p>
          </div>
          {/* мініатюра схеми: питання, від нього — шляхи; обраний — персиковий */}
          <div className="lp-tree" aria-hidden="true">
            <span className="lp-tree__root" />
            <ul className="lp-tree__paths">
              {t.tree.paths.map((path, index) => (
                <li key={path} className={`lp-tree__path ${index === 0 ? 'lp-tree__path--chosen' : ''}`}>
                  {index === 0 && <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.4} />}
                  {path}
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="lp-tile lp-tile--journal" data-reveal>
          <div className="lp-tile__copy">
            <h3>{t.journal.title}</h3>
            <p>{t.journal.text}</p>
          </div>
          <div className="lp-journal" aria-hidden="true">
            <span className="lp-journal__icon">
              <HugeiconsIcon icon={BookOpen01Icon} size={18} strokeWidth={1.8} />
            </span>
            <span className="lp-journal__text">
              <span className="lp-journal__when">{t.journal.when}</span>
              <span className="lp-journal__question">{t.journal.question}</span>
            </span>
          </div>
        </article>

      </div>
    </section>
  );
}
