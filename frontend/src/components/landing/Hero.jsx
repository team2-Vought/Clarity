import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Shot from './Shot';
import { prefersReducedMotion } from './personaTones';
import { ArrowUpIcon } from '../DebateIcons';
import { copy } from '../../copy';

const t = copy.landing;

// Плейсхолдер поля «друкується» сам: підказує, про що можна спитати
function useTypedPlaceholder(phrases, paused) {
  const [text, setText] = useState(phrases[0]);

  useEffect(() => {
    if (paused || prefersReducedMotion()) return undefined;
    let phrase = 0;
    let length = phrases[0].length;
    let deleting = true;
    let timer;
    const tick = () => {
      let delay;
      if (deleting) {
        length -= 1;
        delay = 26;
        if (length === 0) {
          deleting = false;
          phrase = (phrase + 1) % phrases.length;
          delay = 320;
        }
      } else {
        length += 1;
        delay = 55;
        if (length === phrases[phrase].length) {
          deleting = true;
          delay = 2400;
        }
      }
      setText(phrases[phrase].slice(0, length));
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 2400);
    return () => clearTimeout(timer);
  }, [phrases, paused]);

  return text;
}

export default function Hero({ onStart, question, onQuestionChange, starting = false, signedIn = false }) {
  const [focused, setFocused] = useState(false);
  const placeholder = useTypedPlaceholder(t.askPlaceholders, focused || question.length > 0);
  const stageRef = useRef(null);

  // рамка зі скріном лежить «у перспективі» й вирівнюється, поки сторінку гортають
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || prefersReducedMotion()) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.6)));
      stage.style.setProperty('--tilt', String(1 - progress));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const submit = (e) => {
    e.preventDefault();
    if (!starting) onStart(question.trim());
  };

  return (
    <section className="lp-hero" aria-labelledby="landing-title">
      <h1 id="landing-title" className="lp-hero__title lp-enter">
        {t.titleStart} <span className="lp-gradient-text">{t.titleAccent}</span> {t.titleEnd}
      </h1>
      <p className="lp-hero__text lp-enter" style={{ '--delay': '60ms' }}>
        {t.text}
      </p>

      <form className="lp-ask lp-enter" style={{ '--delay': '120ms' }} onSubmit={submit}>
        <label className="sr-only" htmlFor="lp-ask-input">
          {t.askLabel}
        </label>
        <input
          id="lp-ask-input"
          className="lp-ask__input"
          value={question}
          onChange={(e) => onQuestionChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          maxLength={6000}
          autoComplete="off"
        />
        <button
          type="submit"
          className="lp-ask__send"
          aria-label={t.askSubmit}
          disabled={starting}
          aria-busy={starting}
        >
          <ArrowUpIcon />
        </button>
      </form>
      {!signedIn && (
        <p className="lp-ask__hint lp-enter" style={{ '--delay': '150ms' }} role="status">
          {starting ? t.askStarting : t.askHint}
        </p>
      )}

      <div className="lp-stage lp-enter" style={{ '--delay': '180ms' }} ref={stageRef}>
        <div className="lp-frame">
          <Shot name="debate" alt={t.heroShot} eager />
        </div>
      </div>
    </section>
  );
}

Hero.propTypes = {
  onStart: PropTypes.func.isRequired,
  question: PropTypes.string.isRequired,
  onQuestionChange: PropTypes.func.isRequired,
  starting: PropTypes.bool,
  signedIn: PropTypes.bool,
};
