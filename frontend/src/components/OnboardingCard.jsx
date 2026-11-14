import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import logo from '../assets/clarity-logo.webp';
import { copy } from '../copy';

const t = copy.onboarding;
const tc = copy.chat;
const EXAMPLE_QUESTION = copy.landing.demoQuestion;
const EXAMPLE = copy.landing.demoSummary;

/**
 * Перший запуск: не переказ лендингу, а те, що людина отримає, — висновок
 * справжньої форми на прикладі питання. Приклад можна одразу спробувати.
 */
export default function OnboardingCard({ onDismiss, onTry, onMore }) {
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

      <figure className="debate__onboarding-example">
        <figcaption className="debate__onboarding-question">
          <span className="debate__onboarding-question-label">{t.exampleQuestion}</span>
          {EXAMPLE_QUESTION}
        </figcaption>
        {/* стисла версія висновку: вердикт, згода й перший крок — повний
            висновок у чаті має ще плюси, ризики й план, але тут він виштовхнув
            би поле питання за екран */}
        <div className="debate__onboarding-summary">
          <p className="debate__onboarding-verdict">
            <span className="chat__summary-word--yes">{tc.summaryYes}</span>
            {' — '}
            {EXAMPLE.headline.replace(/^[^—]*—\s*/, '')}
          </p>
          <dl className="debate__onboarding-facts">
            <div>
              <dt>{tc.summaryAgreement}</dt>
              <dd>{tc.summaryAgreementValue(EXAMPLE.agreement.agree, EXAMPLE.agreement.total)}</dd>
            </div>
            <div>
              <dt>{tc.summaryFirstStep}</dt>
              <dd>{EXAMPLE.next_steps[0]}</dd>
            </div>
          </dl>
        </div>
      </figure>

      <div className="debate__onboarding-actions">
        <button type="button" className="debate__onboarding-more" onClick={onMore}>
          {t.more}
          <HugeiconsIcon icon={ArrowRight01Icon} size={15} aria-hidden="true" />
        </button>
        <span className="debate__onboarding-buttons">
          <button type="button" className="debate__onboarding-try" onClick={() => onTry(EXAMPLE_QUESTION)}>
            {t.tryExample}
          </button>
          <button type="button" className="debate__onboarding-dismiss" onClick={onDismiss}>
            {t.dismiss}
          </button>
        </span>
      </div>
    </section>
  );
}

OnboardingCard.propTypes = {
  onDismiss: PropTypes.func.isRequired,
  onTry: PropTypes.func.isRequired,
  onMore: PropTypes.func.isRequired,
};
