import PropTypes from 'prop-types';
import logo from '../assets/clarity-logo.webp';
import { copy } from '../copy';

/**
 * Знак Clarity — одна реалізація на всі публічні сторінки.
 * `wordmark` — зі словом «Clarity» поруч (шапки лендингу, документів, станів, спільної дискусії);
 * без нього — лише знак (картка входу, де назва вже в заголовку).
 */
export default function Logo({ onHome, href = '/', wordmark = false, className = '' }) {
  const handleClick = (e) => {
    if (!onHome) return;
    e.preventDefault();
    onHome();
  };

  return (
    <a
      className={`logo${wordmark ? ' logo--wordmark' : ''}${className ? ` ${className}` : ''}`}
      href={href}
      aria-label={copy.common.homeAria}
      onClick={handleClick}
    >
      <img src={logo} alt="" width="56" height="39" />
      {wordmark && <span className="logo__word" aria-hidden="true">{copy.appName}</span>}
    </a>
  );
}

Logo.propTypes = {
  onHome: PropTypes.func,
  href: PropTypes.string,
  wordmark: PropTypes.bool,
  className: PropTypes.string,
};
