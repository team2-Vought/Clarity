import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, SparklesIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import './ThoughtLine.css';

const EASE_OUT = [0.23, 1, 0.32, 1];
const EASE_IN_OUT = [0.77, 0, 0.175, 1];
const GLYPH_DONE = 0.55;
const EMPTY_STEPS = [];

// цілі секунди: десяті частки лише мерехтіли й відволікали
const fmt = (ds) => {
  const seconds = Math.floor(ds / 10);
  if (seconds < 60) return `${seconds} с`;
  return `${Math.floor(seconds / 60)} хв ${String(seconds % 60).padStart(2, '0')} с`;
};

// У DM Sans немає табличних цифр («1» удвічі вужча за «0»), тож кожна цифра
// стоїть у комірці однакової ширини — інакше таймер і стрілка поруч тремтять
const fixedDigits = (text) =>
  [...text].map((char, index) =>
    /\d/.test(char) ? (
      <span key={index} className="thought-line__digit">{char}</span>
    ) : (
      char
    )
  );

// «за 1 секунду / 2 секунди / 5 секунд» — знахідний відмінок після «за»
const plural = (n, one, few, many) => {
  const tens = n % 100;
  if (n % 10 === 1 && tens !== 11) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
};

const spoken = (ds) => {
  const total = Math.floor(ds / 10);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60);
  const secondsText = `${seconds} ${plural(seconds, 'секунду', 'секунди', 'секунд')}`;
  if (!minutes) return secondsText;
  return `${minutes} ${plural(minutes, 'хвилину', 'хвилини', 'хвилин')} ${secondsText}`;
};

export default function ThoughtLine({
  label = 'Thinking…',
  doneLabel = '',
  renderLabel,
  glyph = 'sparkle',
  steps = EMPTY_STEPS,
  // скільки останніх кроків іде зараз: паралельні фази думають кількома AI одразу
  activeCount = 1,
  collapsible = true,
  collapseOnSettle = true,
  color = 'currentColor',
  glyphColor = '',
  fontSize = 16,
  breathPeriod = 1.6,
  breathDepth = 0.45,
  shimmer = true,
  shimmerDuration = 1.8,
  settleDuration = 350,
  settleBlur = 2,
  working = true,
  settleAfter = 0,
  elapsed,
  // момент початку (мс від епохи): таймер іде від нього, а не від монтування,
  // тож не скидається, якщо рядок ненадовго ховали
  startedAt,
  showTimer = true,
  timerLabel = '',
  onSettle,
  className = '',
  style,
}) {
  const reduce = useReducedMotion();
  const [autoSettled, setAutoSettled] = useState(false);
  const [prevWorkingProp, setPrevWorkingProp] = useState(working);
  // новий запуск знімає автозавершення попереднього
  if (prevWorkingProp !== working) {
    setPrevWorkingProp(working);
    if (working) setAutoSettled(false);
  }
  const isWorking = working && !autoSettled;
  const [open, setOpen] = useState(() => isWorking || !collapseOnSettle);
  const doneText = doneLabel || (showTimer ? 'Thought for' : 'Done thinking');
  const hasTrace = steps.length > 0;
  const depth = reduce ? Math.min(breathDepth, 0.2) : breathDepth;
  const period = reduce ? breathPeriod * 1.5 : breathPeriod;
  const trough = 1 - depth;
  const sheen = shimmer && !reduce;

  const glyphRef = useRef(null);
  const breathRef = useRef(null);
  const timerGroupRef = useRef(null);
  const stackRef = useRef(null);
  const workRef = useRef(null);
  const doneRef = useRef(null);
  const dsRef = useRef(0);
  const prevWorking = useRef(isWorking);
  const latest = useRef({ onSettle });
  const [elapsedDs, setElapsedDs] = useState(0);
  const [wasWorking, setWasWorking] = useState(isWorking);
  // зміна стану скидає таймер і розгортання під час рендеру, а не в ефекті
  if (wasWorking !== isWorking) {
    setWasWorking(isWorking);
    if (isWorking) {
      setElapsedDs(0);
      setOpen(true);
    } else if (collapseOnSettle) {
      setOpen(false);
    }
  }
  // явний `elapsed` має пріоритет над власним таймером
  const shownDs = elapsed != null ? Math.round(elapsed * 10) : elapsedDs;

  useEffect(() => {
    latest.current = { onSettle };
  }, [onSettle]);

  useEffect(() => {
    const glyphEl = glyphRef.current;
    const breathEl = breathRef.current;
    if (!breathEl) return undefined;
    const s = settleDuration / 1000;
    const loop = (el, delay) =>
      animate(
        el,
        { opacity: [trough, 1, trough] },
        { duration: period, ease: EASE_IN_OUT, repeat: Infinity, delay }
      );
    let cancelled = false;
    const running = [];
    if (isWorking) {
      if (depth > 0) {
        if (sheen) {
          running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
        }
        if (glyphEl) {
          const lead = animate(glyphEl, { opacity: trough }, { duration: 0.2, ease: EASE_OUT });
          running.push(lead);
          lead.then(() => {
            if (cancelled) return;
            running.push(loop(glyphEl, 0));
            if (!sheen) running.push(loop(breathEl, 0.14));
          });
        } else if (!sheen) {
          running.push(loop(breathEl, 0.14));
        }
      } else {
        if (glyphEl) running.push(animate(glyphEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
        running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
      }
    } else {
      if (glyphEl) running.push(animate(glyphEl, { opacity: GLYPH_DONE }, { duration: s, ease: EASE_OUT }));
      running.push(animate(breathEl, { opacity: 1 }, { duration: s, ease: EASE_OUT }));
    }
    return () => {
      cancelled = true;
      running.forEach((animation) => animation.stop());
    };
  }, [isWorking, period, depth, trough, settleDuration, glyph, sheen]);

  // фаза відблиску прив'язана до спільного годинника сторінки (старт — на нулі
  // часової шкали документа): коли рядок ховають і показують знову, анімація
  // продовжується з того самого місця, а не стартує з початку
  useLayoutEffect(() => {
    const breathEl = breathRef.current;
    if (!breathEl || !isWorking || !sheen) return;
    breathEl.getAnimations?.().forEach((animation) => {
      if (animation.animationName === 'thought-line-shimmer') animation.startTime = 0;
    });
  }, [isWorking, sheen, shimmerDuration]);

  const paint = (ds) => {
    dsRef.current = ds;
    setElapsedDs((current) => (current === ds ? current : ds));
  };

  useLayoutEffect(() => {
    if (elapsed != null) {
      dsRef.current = Math.round(elapsed * 10);
      return undefined;
    }
    if (!isWorking) return undefined;
    const origin = performance.now() - (startedAt ? Math.max(0, Date.now() - startedAt) : 0);
    const tick = () => {
      const ds = Math.floor((performance.now() - origin) / 100);
      paint(ds);
      if (settleAfter > 0 && ds >= Math.round(settleAfter * 10)) setAutoSettled(true);
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [isWorking, elapsed, settleAfter, startedAt]);

  useLayoutEffect(() => {
    const timer = timerGroupRef.current;
    const stack = stackRef.current;
    if (!timer || !stack) return undefined;
    const place = (glide) => {
      const active = isWorking ? workRef.current : doneRef.current;
      if (!active) return;
      const shift = active.offsetWidth - stack.offsetWidth;
      if (!glide) timer.style.transition = 'none';
      timer.style.transform = `translateX(${shift}px)`;
      if (!glide) {
        void timer.offsetWidth;
        timer.style.transition = '';
      }
    };
    place(prevWorking.current !== isWorking);
    prevWorking.current = isWorking;
    const observer = new ResizeObserver(() => place(false));
    if (workRef.current) observer.observe(workRef.current);
    if (doneRef.current) observer.observe(doneRef.current);
    return () => observer.disconnect();
  }, [isWorking, label, doneText, fontSize, showTimer]);

  const activeStep = hasTrace ? steps[steps.length - 1] : '';
  const timerText = showTimer ? `${timerLabel ? `${timerLabel} ` : ''}${spoken(shownDs)}` : '';
  let announce = timerText ? `${doneText} ${timerText}` : doneText;
  if (isWorking) announce = activeStep ? `${label} ${activeStep}` : label;

  useEffect(() => {
    if (!isWorking) latest.current.onSettle?.(dsRef.current / 10);
  }, [isWorking]);

  const toggle = hasTrace && collapsible;
  const head = (
    <>
      {glyph !== 'none' ? (
        <span ref={glyphRef} className="thought-line__glyph" aria-hidden="true">
          {glyph === 'sparkle' ? (
            <HugeiconsIcon icon={SparklesIcon} size="100%" strokeWidth={2} />
          ) : glyph === 'dot' ? (
            <span className="thought-line__dot" />
          ) : (
            glyph
          )}
        </span>
      ) : null}
      <span ref={stackRef} className="thought-line__label" aria-hidden="true">
        <span ref={workRef} className="thought-line__text" data-active={isWorking ? '' : undefined}>
          <span ref={breathRef} className="thought-line__breath" data-shimmer={sheen ? '' : undefined}>
            {renderLabel ? renderLabel(label, true) : label}
          </span>
        </span>
        <span
          ref={doneRef}
          className="thought-line__text thought-line__text--done"
          data-active={isWorking ? undefined : ''}
        >
          {renderLabel ? renderLabel(doneText, false) : doneText}
        </span>
      </span>
      {showTimer ? (
        <span
          ref={timerGroupRef}
          className="thought-line__timer"
          data-done={isWorking ? undefined : ''}
          aria-hidden="true"
        >
          {timerLabel ? <span className="thought-line__timer-label">{timerLabel}</span> : null}
          <span className="thought-line__timer-value">{fixedDigits(fmt(shownDs))}</span>
        </span>
      ) : null}
      {collapsible ? (
        <span className="thought-line__chevron" data-on={hasTrace ? '' : undefined} aria-hidden="true">
          <HugeiconsIcon icon={ArrowDown01Icon} size="1em" strokeWidth={2.2} />
        </span>
      ) : null}
      <span className="thought-line__sr" role="status">
        {announce}
      </span>
    </>
  );

  return (
    <div
      className={`thought-line${className ? ` ${className}` : ''}`}
      data-working={isWorking ? '' : undefined}
      data-open={open && hasTrace ? '' : undefined}
      style={{
        '--tl-font': `${fontSize}px`,
        '--tl-color': color,
        '--tl-glyph': glyphColor || color,
        '--tl-settle': `${settleDuration}ms`,
        '--tl-blur': `${settleBlur}px`,
        '--tl-shimmer': `${shimmerDuration}s`,
        ...style,
      }}
    >
      {collapsible ? (
        <button
          type="button"
          className="thought-line__head"
          data-toggle={toggle ? '' : undefined}
          aria-expanded={toggle ? open : undefined}
          tabIndex={toggle ? 0 : -1}
          onClick={() => {
            if (toggle) setOpen((value) => !value);
          }}
        >
          {head}
        </button>
      ) : (
        <div className="thought-line__head">{head}</div>
      )}
      {hasTrace ? (
        <div className="thought-line__trace" data-open={open ? '' : undefined} aria-hidden={!open}>
          <div className="thought-line__fold">
            <div className="thought-line__steps">
              {steps.map((text, index) => {
                const done = !isWorking || index < steps.length - activeCount;
                return (
                  <div key={`${index}-${text}`} className="thought-line__step" data-done={done ? '' : undefined}>
                    <span className="thought-line__mark" aria-hidden="true">
                      {done ? (
                        <HugeiconsIcon icon={Tick02Icon} size="1em" strokeWidth={2.5} />
                      ) : (
                        <i className="thought-line__pulse" />
                      )}
                    </span>
                    <span className="thought-line__step-text">{text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
