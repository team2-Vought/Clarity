import { Link } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { EXAMPLE_SLUGS } from '../../utils/examples';
import { copy } from '../../copy';

const t = copy.examples;

/** Галерея: справжні дискусії на типові теми — результат видно за секунду, без входу. */
export default function Examples() {
  return (
    <section className="lp-section lp-examples" id="examples" aria-labelledby="examples-title">
      <header className="lp-section__head" data-reveal>
        <h2 id="examples-title" className="lp-section__title">
          {t.title}
        </h2>
        <p className="lp-section__text">{t.text}</p>
      </header>
      <ul className="lp-examples__grid" style={{ '--cols': EXAMPLE_SLUGS.length }}>
        {EXAMPLE_SLUGS.map((slug, index) => {
          const item = t.items[slug];
          return (
            <li key={slug} data-reveal style={{ '--delay': `${index * 60}ms` }}>
              <Link to={`/examples/${slug}`} className="lp-example">
                <span className="lp-example__tag">{item.tag}</span>
                <span className="lp-example__title">{item.title}</span>
                <span className="lp-example__teaser">{item.teaser}</span>
                <span className="lp-example__open">
                  {t.open}
                  <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={2} aria-hidden="true" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
