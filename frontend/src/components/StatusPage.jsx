import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Background } from '../pages/AuthLayout';
import { getToken } from '../api/client';
import logo from '../assets/clarity-logo.webp';
import { copy } from '../copy';

// увійшли — «додому» означає до нової дискусії, інакше — на лендинг
export const homePath = () => (getToken() ? '/home' : '/');

/**
 * Повноекранна сторінка-стан: 404, збій застосунку, недоступне посилання.
 * Без хуків роутера — її показує й ErrorBoundary, що стоїть поза ним.
 * `mark` — великий код («404») або іконка, `actions` — до двох кнопок, перша головна.
 */
export default function StatusPage({ mark, icon, title, text, actions }) {
  return (
    <div className="status-page">
      <Background />
      <header className="status-page__bar">
        <a className="status-page__brand" href={homePath()} aria-label={copy.common.homeAria}>
          <img src={logo} alt="" width="46" height="32" />
          <span>{copy.appName}</span>
        </a>
      </header>
      <main className="status-page__main">
        <section className="status-page__body" aria-labelledby="status-title">
          <div className="status-page__mark" aria-hidden="true">
            {icon ? (
              <span className="status-page__icon">
                <HugeiconsIcon icon={icon} size={40} strokeWidth={1.6} />
              </span>
            ) : (
              <span className="status-page__code">{mark}</span>
            )}
          </div>
          <h1 id="status-title" className="status-page__title">{title}</h1>
          {text && <p className="status-page__text">{text}</p>}
          <div className="status-page__actions">
            {actions.map((action, index) => {
              const className = `status-page__button ${index === 0 ? 'status-page__button--primary' : ''}`;
              return action.href ? (
                <a key={action.label} className={className} href={action.href}>
                  {action.label}
                </a>
              ) : (
                <button key={action.label} type="button" className={className} onClick={action.onClick}>
                  {action.label}
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

StatusPage.propTypes = {
  mark: PropTypes.string,
  icon: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
  title: PropTypes.string.isRequired,
  text: PropTypes.string,
  actions: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      href: PropTypes.string,
      onClick: PropTypes.func,
    })
  ).isRequired,
};
