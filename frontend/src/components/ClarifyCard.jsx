import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { uk } from '../copy/uk';

const t = uk.debate;
const MAX_ANSWER = 500;

/**
 * Уточнювальні питання модератора перед стартом, як тест: до кожного питання —
 * варіанти-пігулки й остання пігулка-поле для своєї відповіді. Вибір варіанта
 * очищає поле, а введений текст знімає вибір — відповідь завжди одна.
 * З'являється так само, як репліка ШІ: картка виїжджає, а питання
 * проявляються з розмиття одне за одним.
 */
export default function ClarifyCard({ questions, answers, onChange, onSubmit, onSkip, disabled }) {
  const cardRef = useRef(null);

  // картка з'являється внизу чату — прокручуємо до неї, а фокус ставимо
  // на саму картку: так Tab веде до варіантів, але жоден не виглядає обраним
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  const handleRadioKeyDown = (e, question, index) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (index + step + question.options.length) % question.options.length;
    onChange(question.id, { option: question.options[next], custom: '' });
    e.currentTarget.parentElement.children[next]?.focus();
  };

  return (
    <form
      className="clarify"
      ref={cardRef}
      tabIndex={-1}
      aria-labelledby="clarify-title"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h2 id="clarify-title" className="clarify__title clarify__reveal" style={{ '--item': 0 }}>
        {t.clarifyTitle}
      </h2>

      <ol className="clarify__list">
        {questions.map((question, qIndex) => {
          const answer = answers[question.id] || {};
          const titleId = `clarify-q-${question.id}`;
          // у групі радіокнопок фокус табом потрапляє лише на одну: обрану або першу
          const tabIndexOf = (option, index) =>
            answer.option ? (answer.option === option ? 0 : -1) : index === 0 ? 0 : -1;
          return (
            <li
              key={question.id}
              className="clarify__item clarify__reveal"
              style={{ '--item': qIndex + 1 }}
            >
              <p id={titleId} className="clarify__question">{question.question}</p>
              <div className="clarify__options">
                <div className="clarify__radios" role="radiogroup" aria-labelledby={titleId}>
                  {question.options.map((option, index) => {
                    const active = answer.option === option && !answer.custom;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        tabIndex={tabIndexOf(option, index)}
                        className={`clarify__option ${active ? 'clarify__option--active' : ''}`}
                        onClick={() => onChange(question.id, { option: active ? '' : option, custom: '' })}
                        onKeyDown={(e) => handleRadioKeyDown(e, question, index)}
                        disabled={disabled}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  className={`clarify__custom ${answer.custom ? 'clarify__custom--filled' : ''}`}
                  value={answer.custom || ''}
                  maxLength={MAX_ANSWER}
                  onChange={(e) => onChange(question.id, { option: '', custom: e.target.value })}
                  placeholder={t.clarifyCustom}
                  aria-label={t.clarifyCustomLabel(question.question)}
                  disabled={disabled}
                />
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="clarify__actions clarify__reveal" style={{ '--item': questions.length + 1 }}>
        <button type="button" className="clarify__skip" onClick={onSkip} disabled={disabled}>
          {t.clarifySkip}
        </button>
        <button type="submit" className="clarify__start" disabled={disabled}>
          {disabled ? t.creating : t.clarifyStart}
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
