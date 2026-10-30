import PropTypes from 'prop-types';
import logo from '../assets/clarity-logo.webp';
import { copy } from '../copy';

export default function Logo({ onHome }) {
  const handleClick = (e) => {
    if (!onHome) return;
    e.preventDefault();
    onHome();
  };

  return (
    <a className="logo" href="#/" aria-label={copy.common.homeAria} onClick={handleClick}>
      <img src={logo} alt="" width="56" height="39" />
    </a>
  );
}

Logo.propTypes = {
  onHome: PropTypes.func,
};
