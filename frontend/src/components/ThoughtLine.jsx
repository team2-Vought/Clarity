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
  // false — гліф має власну анімацію (як логотип), тож не блимаємо ним зверху
  glyphBreath = true,
  steps = EMPTY_STEPS,
  // скільки останніх кроків іде зараз: паралельні фази думають кількома AI одразу
  activeCount = 1,
  collapsible = true,
  collapseOnSettle = true,
  // false — під час роботи кроки згорнуті, поки їх не розгорнуть самі
  openOnWork = true,
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
  // системне налаштування або «Менше анімації» в налаштуваннях застосунку
  const reduce = useReducedMotion() || document.documentElement.dataset.motion === 'reduced';
  const [autoSettled, setAutoSettled] = useState(false);
  const [prevWorkingProp, setPrevWorkingProp] = useState(working);
  // новий запуск знімає автозавершення попереднього
  if (prevWorkingProp !== working) {
    setPrevWorkingProp(working);
    if (working) setAutoSettled(false);
  }
  const isWorking = working && !autoSettled;
  const [open, setOpen] = useState(() => (isWorking ? openOnWork : !collapseOnSettle));
  const doneText = doneLabel || (showTimer ? 'Thought for' : 'Done thinking');
  const hasTrace = steps.length > 0;
  const depth = reduce ? Math.min(breathDepth, 0.2) : breathDepth;
  const period = reduce ? breathPeriod * 1.5 : breathPeriod;
  const trough = 1 - depth;
  const sheen = shimmer && !reduce;

  const glyphRef = useRef(null);
  const breathRef = useRef(null);
  const timerGroupRef = useRef(null);
  const chevronRef = useRef(null);
  const stackRef = useRef(null);
  const workRef = useRef(null);
  const doneRef = useRef(null);
  const dsRef = useRef(0);
  const prevWorking = useRef(isWorking);
  const latest = useRef({ onSettle });
  const [elapsedDs, setElapsedDs] = useState(0);
  // новий напис під час роботи приходить плавно, а старий ще мить тане поверх:
  // `n` — номер зміни (ключ анімації), `previous` — напис, що йде
  const [swap, setSwap] = useState({ label, previous: '', n: 0 });
  if (swap.label !== label) {
    setSwap({ label, previous: isWorking && !reduce ? swap.label : '', n: swap.n + 1 });
  }
  const labelWidth = useRef(0);
  const [wasWorking, setWasWorking] = useState(isWorking);
  // зміна стану скидає таймер і розгортання під час рендеру, а не в ефекті
  if (wasWorking !== isWorking) {
    setWasWorking(isWorking);
    if (isWorking) {
      setElapsedDs(0);
      setOpen(openOnWork);
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
    const glyphEl = glyphBreath ? glyphRef.current : null;
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
    if (!glyphBreath && glyphRef.current) {
      const target = isWorking ? 1 : GLYPH_DONE;
      running.push(animate(glyphRef.current, { opacity: target }, { duration: isWorking ? 0.2 : s, ease: EASE_OUT }));
    }
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
  }, [isWorking, period, depth, trough, settleDuration, glyph, glyphBreath, sheen]);

  // фаза відблиску прив'язана до спільного годинника сторінки (старт — на нулі
  // часової шкали документа): коли рядок ховають і показують знову, анімація
  // продовжується з того самого місця, а не стартує з початку
  useLayoutEffect(() => {
    const breathEl = breathRef.current;
    if (!breathEl || !isWorking || !sheen) return;
    // відблиск малюють написи всередині, і кожен новий підхоплює ту саму фазу
    breathEl.getAnimations?.({ subtree: true }).forEach((animation) => {
      if (animation.animationName === 'thought-line-shimmer') animation.startTime = 0;
    });
  }, [isWorking, sheen, shimmerDuration, swap.n]);

  // ширина напису перетікає від старої до нової, а таймер зі стрілкою їдуть
  // слідом (їх підсуває ResizeObserver нижче), замість стрибка
  useLayoutEffect(() => {
    const breathEl = breathRef.current;
    if (!breathEl) return undefined;
    const from = labelWidth.current;
    breathEl.style.width = '';
    const to = breathEl.offsetWidth;
    labelWidth.current = to;
    if (!swap.n || !isWorking || reduce || !from || from === to) return undefined;
    const glide = animate(breathEl, { width: [`${from}px`, `${to}px`] }, { duration: 0.4, ease: EASE_OUT });
    glide.then(() => {
      breathEl.style.width = '';
    });
    return () => glide.stop();
  }, [swap.n, isWorking, reduce]);

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
    const chevron = chevronRef.current;
    const stack = stackRef.current;
    // написи стоять один на одному, тож ширина стека — ширший із двох; таймер і
    // стрілку зсуваємо до кінця активного напису, щоб між ними не лишалось дірки
    const followers = [timer, chevron].filter(Boolean);
    if (!stack || followers.length === 0) return undefined;
    const place = (glide) => {
      const active = isWorking ? workRef.current : doneRef.current;
      if (!active) return;
      const shift = active.offsetWidth - stack.offsetWidth;
      if (!glide) followers.forEach((el) => { el.style.transition = 'none'; });
      if (timer) timer.style.transform = `translateX(${shift}px)`;
      // окрема властивість translate, щоб не збивати поворот стрілки з CSS
      if (chevron) chevron.style.translate = `${shift}px 0`;
      if (!glide) {
        void stack.offsetWidth;
        followers.forEach((el) => { el.style.transition = ''; });
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
            <span key={swap.n} className="thought-line__swap" data-enter={swap.previous ? '' : undefined}>
              {renderLabel ? renderLabel(label, true) : label}
            </span>
            {swap.previous ? (
              <span
                key={`out-${swap.n}`}
                className="thought-line__swap thought-line__swap--out"
                onAnimationEnd={(event) => {
                  if (event.animationName !== 'thought-line-swap-out') return;
                  const n = swap.n;
                  setSwap((current) => (current.n === n ? { ...current, previous: '' } : current));
                }}
              >
                {renderLabel ? renderLabel(swap.previous, true) : swap.previous}
              </span>
            ) : null}
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
        <span
          ref={chevronRef}
          className="thought-line__chevron"
          data-on={hasTrace ? '' : undefined}
          aria-hidden="true"
        >
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
