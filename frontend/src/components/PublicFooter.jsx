import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { LANGUAGES, copy, lang, setLanguagePref } from '../copy';
import { openBugReport } from '../utils/bugReport';

const t = copy.landing;
const NAMES = { uk: 'Українська', en: 'English' };

/**
 * Низ публічних сторінок (лендинг, документи, спільна дискусія):
 * копірайт, документи, «Знайшли баги?» і мова. Одна розмітка — один вигляд усюди.
 */
export default function PublicFooter({ className = '' }) {
  return (
    <footer className={`public-footer ${className}`.trim()}>
      <span className="public-footer__copy">{t.footer}</span>
      <nav className="public-footer__nav" aria-label={t.footerNav}>
        <Link to="/privacy">{t.privacy}</Link>
        <Link to="/terms">{t.terms}</Link>
        <button type="button" onClick={() => openBugReport()}>
          {copy.report.trigger}
        </button>
      </nav>
      <label className="public-footer__lang">
        <span className="sr-only">{t.language}</span>
        <select value={lang} onChange={(e) => setLanguagePref(e.target.value)}>
          {LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {NAMES[code]}
            </option>
          ))}
        </select>
      </label>
    </footer>
  );
}

PublicFooter.propTypes = {
  className: PropTypes.string,
};
