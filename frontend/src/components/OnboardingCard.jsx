import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import logo from '../assets/clarity-logo.webp';
import { copy } from '../copy';

const t = copy.onboarding;

/** Перший запуск: що таке Clarity у трьох кроках і що налаштовувати не обов'язково. */
export default function OnboardingCard({ onDismiss, onMore }) {
  return (
    <section className="debate__onboarding" aria-labelledby="onboarding-title">
      <div className="debate__onboarding-head">
        <span className="debate__onboarding-label">{t.label}</span>
        <h2 id="onboarding-title" className="debate__onboarding-title">
          {t.title}{' '}
          <span className="debate__onboarding-brand">
            <img src={logo} alt="" width="56" height="39" />
            {t.brand}
          </span>
        </h2>
        <p className="debate__onboarding-lead">{t.lead}</p>
      </div>
      <ol className="debate__onboarding-steps">
        {t.steps.map((step, index) => (
          <li key={step.title} className="debate__onboarding-step">
            <span className="debate__onboarding-num" aria-hidden="true">{index + 1}</span>
            <span className="debate__onboarding-step-title">{step.title}</span>
            <span className="debate__onboarding-step-text">{step.text}</span>
          </li>
        ))}
      </ol>
      <p className="debate__onboarding-note">{t.defaults}</p>
      <div className="debate__onboarding-actions">
        <button type="button" className="debate__onboarding-more" onClick={onMore}>
          {t.more}
          <HugeiconsIcon icon={ArrowRight01Icon} size={15} aria-hidden="true" />
        </button>
        <button type="button" className="debate__onboarding-dismiss" onClick={onDismiss}>
          {t.dismiss}
        </button>
      </div>
    </section>
  );
}

OnboardingCard.propTypes = {
  onDismiss: PropTypes.func.isRequired,
  onMore: PropTypes.func.isRequired,
};
