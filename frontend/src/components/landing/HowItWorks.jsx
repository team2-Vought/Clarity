import { useEffect, useRef, useState } from 'react';
import Shot from './Shot';
import { copy } from '../../copy';

const t = copy.landing;

// Кроки гортаються зліва, а скрін праворуч «прилипає» й змінюється під активний крок.
// На телефоні липкої рамки немає — кожен крок показує свій скрін під текстом.
export default function HowItWorks() {
  const [active, setActive] = useState(0);
  const stepRefs = useRef([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(Number(entry.target.dataset.index));
        });
      },
      { rootMargin: '-45% 0px -45% 0px' }
    );
    stepRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section className="lp-section lp-how" id="how" aria-labelledby="how-title">
      <header className="lp-section__head" data-reveal>
        <h2 id="how-title" className="lp-section__title">
          {t.howTitle}
        </h2>
      </header>

      <div className="lp-how__grid">
        <ol className="lp-steps">
          {t.steps.map((step, i) => (
            <li
              key={step.shot}
              ref={(el) => {
                stepRefs.current[i] = el;
              }}
              data-index={i}
              className={`lp-step${active === i ? ' lp-step--active' : ''}`}
            >
              <span className="lp-step__num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="lp-step__body">
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <div className="lp-step__shot lp-frame">
                  <Shot name={step.shot} alt={step.alt} />
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="lp-how__sticky" aria-hidden="true">
          <div className="lp-frame lp-how__frame">
            <div className="lp-how__shots">
              {t.steps.map((step, i) => (
                <div key={step.shot} className={`lp-how__shot${active === i ? ' lp-how__shot--active' : ''}`}>
                  <Shot name={step.shot} alt="" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
