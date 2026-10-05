import PropTypes from 'prop-types';
import logo from '../assets/Clarity_logo_8.svg';
import { uk } from '../copy/uk';

export default function Logo({ onHome }) {
  const handleClick = (e) => {
    if (!onHome) return;
    e.preventDefault();
    onHome();
  };

  return (
    <a className="logo" href="#/" aria-label={uk.common.homeAria} onClick={handleClick}>
      <img src={logo} alt="" width="56" height="39" />
    </a>
  );
}

Logo.propTypes = {
  onHome: PropTypes.func,
};
