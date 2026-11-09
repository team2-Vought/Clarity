import PropTypes from 'prop-types';
import { lang } from '../../copy';

// англійський лендинг показує англомовний інтерфейс: окремі знімки з суфіксом -en
const suffix = lang === 'en' ? '-en' : '';

// Скрін застосунку у двох темах: CSS показує той, що пасує до теми сторінки.
// Прихований <img loading="lazy"> браузер не завантажує, тож зайвого трафіку немає.
// `eager` стосується лише скріна поточної теми — другий підтягнеться, коли тему перемкнуть.
export default function Shot({ name, alt, width = 2880, height = 1800, eager = false }) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const props = (shown) =>
    eager && shown ? { loading: 'eager', fetchPriority: 'high' } : { loading: 'lazy' };
  return (
    <span className="shot">
      <img
        className="shot__img shot__img--light"
        src={`/landing/${name}-light${suffix}.webp`}
        alt={alt}
        width={width}
        height={height}
        {...props(!dark)}
        decoding="async"
      />
      <img
        className="shot__img shot__img--dark"
        src={`/landing/${name}-dark${suffix}.webp`}
        alt={alt}
        width={width}
        height={height}
        {...props(dark)}
        decoding="async"
      />
    </span>
  );
}

Shot.propTypes = {
  name: PropTypes.string.isRequired,
  alt: PropTypes.string.isRequired,
  width: PropTypes.number,
  height: PropTypes.number,
  eager: PropTypes.bool,
};
