import PropTypes from 'prop-types';
import { Link, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import PublicFooter from '../components/PublicFooter';
import { VisionTrigger } from '../components/VisionDialog';
import { copy } from '../copy';
import { useDeviceTheme } from '../hooks/useDeviceTheme';
import { usePageTitle } from '../hooks/usePageTitle';
import { legalContact } from '../utils/legal';

const t = copy.legal;

/** Політика конфіденційності або Умови користування: один шаблон, тексти — у copy/legal.*.js. */
export default function LegalPage({ doc }) {
  const navigate = useNavigate();
  useDeviceTheme();
  const page = t[doc];
  usePageTitle(page.title);
  const { operator, contact } = legalContact();
  const other = doc === 'privacy' ? 'terms' : 'privacy';

  return (
    <div className="legal">
      <header className="legal__bar">
        <Logo onHome={() => navigate('/')} wordmark />
        <VisionTrigger compact />
      </header>
      <main className="legal__main">
        <article className="legal__doc" aria-labelledby="legal-title">
          <h1 id="legal-title" className="legal__title">{page.title}</h1>
          <p className="legal__updated">{t.updated}</p>
          <p className="legal__lead">{page.lead}</p>
          {page.sections.map((section, index) => (
            <section key={section.title} className="legal__section" aria-labelledby={`legal-${index}`}>
              <h2 id={`legal-${index}`}>{section.title}</h2>
              {section.body(operator, contact).map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
            </section>
          ))}
          <p className="legal__other">
            <Link to={`/${other}`}>{t.otherDoc[doc]}</Link>
          </p>
        </article>
      </main>
      <PublicFooter />
    </div>
  );
}

LegalPage.propTypes = {
  doc: PropTypes.oneOf(['privacy', 'terms']).isRequired,
};
