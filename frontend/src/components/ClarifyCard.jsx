import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, ArrowRight01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { copy } from '../copy';

const t = copy.debate;
const MAX_ANSWER = 500;

/**
 * Уточнювальні питання модератора, як у ChatGPT чи Claude: по одному питанню
 * за раз, варіанти — нумерованим списком, останній рядок — поле своєї
 * відповіді. Вибір варіанта гортає до наступного питання; цифри 1–9 обирають
 * варіант з клавіатури. Вибір варіанта очищає поле, а введений текст знімає
 * вибір — відповідь завжди одна.
 * Поява така сама, як у репліки ШІ: картка виїжджає, а питання проявляється
 * з розмиття.
 */
export default function ClarifyCard({ questions, answers, onChange, onSubmit, onSkip, disabled }) {
  const [step, setStep] = useState(0);
  const cardRef = useRef(null);
  const question = questions[Math.min(step, questions.length - 1)];
  const answer = answers[question.id] || {};
  const isLast = step >= questions.length - 1;

  // картка стоїть над полем вводу й завжди на виду; фокус ставимо на саму
  // картку: так цифри й Tab працюють одразу, але жоден варіант не виглядає обраним
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  // попереднє питання зникло разом із кнопкою у фокусі — повертаємо фокус
  // картці, щоб цифри й Tab працювали й на новому питанні
  useEffect(() => {
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) card.focus({ preventScroll: true });
  }, [step]);

  const goTo = (next) => {
    setStep(Math.max(0, Math.min(questions.length - 1, next)));
  };

  const choose = (option) => {
    const active = answer.option === option && !answer.custom;
    onChange(question.id, { option: active ? '' : option, custom: '' });
    // одразу до наступного питання — без паузи після вибору
    if (!active && !isLast) goTo(step + 1);
  };

  const handleKeyDown = (e) => {
    if (disabled || e.target.tagName === 'INPUT' || e.altKey || e.ctrlKey || e.metaKey) return;
    const index = Number(e.key) - 1;
    if (Number.isInteger(index) && index >= 0 && index < question.options.length) {
      e.preventDefault();
      choose(question.options[index]);
    }
  };

  const handleRadioKeyDown = (e, index) => {
    const delta = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + question.options.length) % question.options.length;
    e.currentTarget.parentElement.children[next]?.focus();
  };

  return (
    <form
      className="clarify"
      ref={cardRef}
      tabIndex={-1}
      aria-label={t.clarifyTitle}
      onKeyDown={handleKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        if (isLast) onSubmit();
        else goTo(step + 1);
      }}
    >
      {/* key: нове питання проявляється так само, як абзац репліки */}
      <header key={question.id} className="clarify__head clarify__reveal">
        <p id={`clarify-q-${question.id}`} className="clarify__question">{question.question}</p>
        {questions.length > 1 && (
          <nav className="clarify__nav" aria-label={t.clarifyNav}>
            <button
              type="button"
              className="clarify__arrow"
              onClick={() => goTo(step - 1)}
              disabled={step === 0}
              aria-label={t.clarifyPrev}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
            </button>
            <span className="clarify__step" aria-live="polite">
              {t.clarifyStep(step + 1, questions.length)}
            </span>
            <button
              type="button"
              className="clarify__arrow"
              onClick={() => goTo(step + 1)}
              disabled={isLast}
              aria-label={t.clarifyNext}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
            </button>
          </nav>
        )}
      </header>

      <div key={`body-${question.id}`} className="clarify__body clarify__reveal">
        <div className="clarify__options" role="radiogroup" aria-labelledby={`clarify-q-${question.id}`}>
          {question.options.map((option, index) => {
            const active = answer.option === option && !answer.custom;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                className={`clarify__option ${active ? 'clarify__option--active' : ''}`}
                onClick={() => choose(option)}
                onKeyDown={(e) => handleRadioKeyDown(e, index)}
                disabled={disabled}
              >
                <span className="clarify__key" aria-hidden="true">{index + 1}</span>
                <span className="clarify__option-text">{option}</span>
                {active && (
                  <HugeiconsIcon icon={Tick02Icon} size={18} className="clarify__tick" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
        <label className={`clarify__other ${answer.custom ? 'clarify__other--filled' : ''}`}>
          <span className="clarify__key" aria-hidden="true">{question.options.length + 1}</span>
          <input
            type="text"
            className="clarify__custom"
            value={answer.custom || ''}
            maxLength={MAX_ANSWER}
            onChange={(e) => onChange(question.id, { option: '', custom: e.target.value })}
            placeholder={t.clarifyCustom}
            aria-label={t.clarifyCustomLabel(question.question)}
            disabled={disabled}
          />
        </label>
      </div>

      <footer className="clarify__actions">
        <button type="button" className="clarify__skip" onClick={onSkip} disabled={disabled}>
          {t.clarifySkip}
        </button>
        <button type="submit" className="clarify__start" disabled={disabled}>
          {disabled ? t.creating : isLast ? t.clarifyStart : t.clarifyNextButton}
        </button>
      </footer>
    </form>
  );
}

ClarifyCard.propTypes = {
  questions: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      question: PropTypes.string.isRequired,
      options: PropTypes.arrayOf(PropTypes.string).isRequired,
    })
  ).isRequired,
  answers: PropTypes.objectOf(
    PropTypes.shape({ option: PropTypes.string, custom: PropTypes.string })
  ).isRequired,
  onChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onSkip: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};
