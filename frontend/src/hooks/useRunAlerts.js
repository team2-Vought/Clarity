import { useEffect, useRef, useState } from 'react';
import { alertUser, isAway } from '../utils/notify';
import { copy } from '../copy';

const t = copy.notify;

// чим закінчилась робота AI — і як позначити вкладку, доки людина не повернеться
const MARKS = { done: t.tabDone, clarify: t.tabWaiting, failed: t.tabWaiting };

// що з дискусією зараз — порівнюємо з попереднім станом, щоб помітити кінець роботи
const stateOf = (discussion) => {
  if (!discussion) return null;
  if (discussion.is_running) return 'working';
  if (discussion.phase === 'done' || discussion.is_finished) return 'done';
  if (discussion.phase === 'clarify' && discussion.clarify_questions?.length > 0) return 'clarify';
  if (discussion.status === 'failed') return 'failed';
  return 'idle';
};

const shortText = (text, limit = 140) => {
  const clean = String(text || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
};

/**
 * Кличе людину, коли AI закінчили роботу, а вона дивиться деінде: звук,
 * системне сповіщення й позначка в назві вкладки, доки людина не повернеться.
 * Повертає позначку для назви вкладки ('' — нічого не сталося).
 */
export function useRunAlerts(discussion) {
  const state = stateOf(discussion);
  const [tracked, setTracked] = useState(state);
  // подія, якою кличемо людину: { kind } — лише перехід, побачений на цій сторінці
  const [event, setEvent] = useState(null);
  const discussionRef = useRef(discussion);

  if (state !== tracked) {
    setTracked(state);
    if (tracked === 'working' && MARKS[state] && isAway()) setEvent({ kind: state });
  }

  useEffect(() => {
    discussionRef.current = discussion;
  });

  useEffect(() => {
    if (!event) return;
    const current = discussionRef.current;
    const title = current?.title || '';
    const message = {
      done: [t.doneTitle, shortText(current?.final_summary?.decision) || title],
      clarify: [t.clarifyTitle, t.clarify],
      failed: [t.failedTitle, t.failed],
    }[event.kind];
    alertUser({ title: message[0], body: message[1], tag: `clarity-${current?.id}` });
  }, [event]);

  // людина повернулась — позначка у вкладці більше не потрібна
  useEffect(() => {
    if (!event) return undefined;
    const clear = () => {
      if (!isAway()) setEvent(null);
    };
    document.addEventListener('visibilitychange', clear);
    window.addEventListener('focus', clear);
    return () => {
      document.removeEventListener('visibilitychange', clear);
      window.removeEventListener('focus', clear);
    };
  }, [event]);

  return event ? MARKS[event.kind] : '';
}
