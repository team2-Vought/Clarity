import { useEffect, useMemo, useRef, useState } from 'react';

// Темп «друку»: довгі відповіді не з'являються миттєво, але й не тягнуться
// вічно — тривалість обмежена, тож 200 слів друкуються приблизно за 9 секунд.
const MS_PER_WORD = 45;
const MIN_DURATION = 900;
const MAX_DURATION = 9000;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * Поступово відкриває текст слово за словом.
 * `children(visibleText, isTyping)` малює вже показану частину.
 * `skip` миттєво показує весь текст; `onDone` викликається один раз у кінці.
 */
export default function TypewriterText({ text, skip = false, onDone, onProgress, children }) {
  const tokens = useMemo(() => String(text || '').split(/(\s+)/), [text]);
  const [reduced] = useState(prefersReducedMotion);
  const [count, setCount] = useState(0);
  const onDoneRef = useRef(onDone);
  const onProgressRef = useRef(onProgress);
  const doneRef = useRef(false);

  useEffect(() => {
    onDoneRef.current = onDone;
    onProgressRef.current = onProgress;
  });

  const instant = skip || reduced;
  const shown = instant ? tokens.length : count;
  const finished = shown >= tokens.length;

  useEffect(() => {
    if (instant) return undefined;
    const words = tokens.filter((token) => token.trim()).length;
    const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, words * MS_PER_WORD));
    const start = performance.now();
    let frame = 0;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      setCount(Math.ceil(progress * tokens.length));
      onProgressRef.current?.();
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tokens, instant]);

  useEffect(() => {
    if (!finished || doneRef.current) return;
    doneRef.current = true;
    onProgressRef.current?.();
    onDoneRef.current?.();
  }, [finished]);

  return children(tokens.slice(0, shown).join(''), !finished);
}
