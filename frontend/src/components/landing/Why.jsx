import { copy } from '../../copy';

const t = copy.landing;

/** Чим Clarity відрізняється від одного чат-бота: три пари «один — команда». */
export default function Why() {
  return (
    <section className="lp-section lp-why" id="why" aria-labelledby="why-title">
      <header className="lp-section__head" data-reveal>
        <h2 id="why-title" className="lp-section__title">
          {t.whyTitle}
        </h2>
        <p className="lp-section__text">{t.whyText}</p>
      </header>
      <ul className="lp-why__list">
        {t.why.map((item, i) => (
          <li key={item.team} className="lp-why__row" data-reveal style={{ '--delay': `${i * 70}ms` }}>
            <p className="lp-why__one">
              <span className="lp-why__who">{t.whyOne}</span>
              {item.one}
            </p>
            <p className="lp-why__team">
              <span className="lp-why__who">{t.whyTeam}</span>
              {item.team}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
