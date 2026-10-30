import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { toneOf } from './personaTones';
import { roleIcon } from '../../utils/debateOptions';
import { copy } from '../../copy';

const t = copy.landing;

export default function Team() {
  // на сенсорних екранах наведення немає — картку перевертає дотик
  const [flipped, setFlipped] = useState(null);

  return (
    <section className="lp-section lp-team" id="team" aria-labelledby="team-title">
      <header className="lp-section__head" data-reveal>
        <h2 id="team-title" className="lp-section__title">
          {t.teamTitle}
        </h2>
        <p className="lp-section__text">{t.teamText}</p>
      </header>

      <ul className="lp-personas">
        {t.personas.map((p, i) => (
          <li key={p.slug} data-reveal style={{ '--delay': `${i * 70}ms` }}>
            <button
              type="button"
              className={`lp-persona${flipped === p.slug ? ' lp-persona--flipped' : ''}`}
              style={{ '--tone': toneOf(p.slug) }}
              aria-pressed={flipped === p.slug}
              onClick={() => setFlipped((cur) => (cur === p.slug ? null : p.slug))}
            >
              <span className="lp-persona__face lp-persona__front">
                <span className="lp-persona__icon">
                  <HugeiconsIcon icon={roleIcon(p.slug)} size={26} strokeWidth={1.7} />
                </span>
                <span className="lp-persona__name">{p.name}</span>
                <span className="lp-persona__trait">{p.trait}</span>
                <span className="lp-persona__text">{p.text}</span>
                <span className="lp-persona__hint">{t.teamHint}</span>
              </span>
              <span className="lp-persona__face lp-persona__back">
                <span className="lp-persona__quote">«{p.quote}»</span>
                <span className="lp-persona__by">
                  <HugeiconsIcon icon={roleIcon(p.slug)} size={15} strokeWidth={1.8} />
                  {p.name}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="lp-judges" data-reveal>
        {t.judges.map((j) => (
          <div key={j.slug} className={`lp-judge lp-judge--${j.slug}`} style={{ '--tone': toneOf(j.slug) }}>
            <span className="lp-judge__icon">
              <HugeiconsIcon icon={roleIcon(j.slug)} size={20} strokeWidth={1.8} />
            </span>
            <span>
              <strong>{j.name}</strong>
              <span className="lp-judge__text">{j.text}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
