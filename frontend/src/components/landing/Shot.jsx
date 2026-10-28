import PropTypes from 'prop-types';

// Скрін застосунку у двох темах: CSS показує той, що пасує до теми сторінки.
// Прихований <img loading="lazy"> браузер не завантажує, тож зайвого трафіку немає.
export default function Shot({ name, alt, width = 2880, height = 1800, eager = false }) {
  const loading = eager ? 'eager' : 'lazy';
  return (
    <span className="shot">
      <img
        className="shot__img shot__img--light"
        src={`/landing/${name}-light.webp`}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding="async"
      />
      <img
        className="shot__img shot__img--dark"
        src={`/landing/${name}-dark.webp`}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
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
