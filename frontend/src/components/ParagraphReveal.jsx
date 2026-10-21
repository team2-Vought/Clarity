import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { blockWords, parseBlocks } from '../utils/markdown';

// Репліка з'являється не словами, а готовими абзацами, як відповіді Siri:
// пауза («модель дописує абзац») → абзац проявляється з розмиття.
// Пауза залежить від довжини наступного абзацу, але не тягнеться вічно.
const FIRST_DELAY = 650;
const MS_PER_WORD = 30;
const MIN_DELAY = 480;
const MAX_DELAY = 1700;
// стільки триває поява останнього абзацу — після неї репліка вважається показаною
const SETTLE_MS = 700;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const delayFor = (block, index) =>
  index === 0
    ? FIRST_DELAY
    : Math.min(MAX_DELAY, Math.max(MIN_DELAY, blockWords(block) * MS_PER_WORD));

/**
 * Поступово показує блоки тексту.
 * `children(blocks, pending)` малює вже показані блоки; `pending` — чи ще
 * «генерується» наступний. Висота плавно тягнеться за вмістом.
 * `skip` миттєво показує все; `onDone` викликається один раз у кінці.
 */
export default function ParagraphReveal({ content, skip = false, onDone, children }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  const [reduced] = useState(prefersReducedMotion);
  const [count, setCount] = useState(0);
  const [height, setHeight] = useState(null);
  const innerRef = useRef(null);
  const onDoneRef = useRef(onDone);
  const doneRef = useRef(false);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const instant = skip || reduced;
  const shown = instant ? blocks.length : Math.min(count, blocks.length);
  const finished = shown >= blocks.length;

  useEffect(() => {
    if (instant || finished) return undefined;
    const timer = setTimeout(() => setCount((value) => value + 1), delayFor(blocks[count], count));
    return () => clearTimeout(timer);
  }, [blocks, count, instant, finished]);

  useEffect(() => {
    if (!finished || doneRef.current) return undefined;
    const timer = setTimeout(() => {
      doneRef.current = true;
      onDoneRef.current?.();
    }, instant ? 0 : SETTLE_MS);
    return () => clearTimeout(timer);
  }, [finished, instant]);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return undefined;
    setHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="chat__grow" style={height === null ? undefined : { height }}>
      <div ref={innerRef}>{children(blocks.slice(0, shown), !finished)}</div>
    </div>
  );
}
