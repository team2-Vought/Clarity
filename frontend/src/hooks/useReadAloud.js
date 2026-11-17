import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canSpeak, createSpeaker } from '../utils/voice';
import { lang } from '../copy';

const PREF_KEY = 'clarity:read-aloud';
const SPOKEN_ROLES = new Set(['ai', 'moderator', 'devil']);

const readPref = () => {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
};

const writePref = (on) => {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // без сховища вибір просто не переживе перезавантаження
  }
};

/** Тембр репліки: учасник — за своїм slug, модератор і AI Devil — за роллю. */
export const voiceKeyOf = (message) => (message.role === 'ai' ? message.persona_slug : message.role);

const speakable = (message) =>
  Boolean(message?.id) && !message.draft && SPOKEN_ROLES.has(message.role) && Boolean(message.content);

/**
 * Озвучення чату. Увімкнене — нові репліки звучать, щойно приходять, кожна своїм
 * голосом; щойно увімкнули — спершу звучить остання репліка. Будь-яку репліку
 * можна послухати окремо (speakMessage).
 */
export function useReadAloud(messages) {
  const supported = canSpeak();
  const speaker = useMemo(() => (supported ? createSpeaker(lang) : null), [supported]);
  const [enabled, setEnabled] = useState(() => supported && readPref());
  const [speakingId, setSpeakingId] = useState(null);
  // репліки, які вже прозвучали чи були на екрані до увімкнення: двічі не читаємо
  const seenRef = useRef(null);

  useEffect(() => {
    if (!speaker) return undefined;
    const unsubscribe = speaker.subscribe(setSpeakingId);
    return () => {
      unsubscribe();
      speaker.stop();
    };
  }, [speaker]);

  useEffect(() => {
    if (!speaker || !messages) return;
    const list = messages.filter(speakable);
    if (seenRef.current === null) {
      // перше завантаження чату: історію не зачитуємо, лише те, що прийде далі
      seenRef.current = new Set(list.map((m) => m.id));
      return;
    }
    if (!enabled) return;
    for (const message of list) {
      if (seenRef.current.has(message.id)) continue;
      seenRef.current.add(message.id);
      speaker.say(message.content, { key: voiceKeyOf(message), id: message.id });
    }
  }, [messages, enabled, speaker]);

  const toggle = useCallback(() => {
    if (!speaker) return;
    const next = !enabled;
    setEnabled(next);
    writePref(next);
    if (!next) {
      speaker.stop();
      return;
    }
    // щойно увімкнули — озвучуємо останню репліку, далі — нові
    const list = (messages || []).filter(speakable);
    seenRef.current = new Set(list.map((m) => m.id));
    const last = list[list.length - 1];
    if (last) speaker.say(last.content, { key: voiceKeyOf(last), id: last.id });
  }, [speaker, messages, enabled]);

  // стабільна функція: реплікам (memo) не треба перемальовуватись, коли змінюється мовець
  const speakingRef = useRef(null);
  useEffect(() => {
    speakingRef.current = speakingId;
  }, [speakingId]);
  const speakMessage = useCallback(
    (message) => {
      if (!speaker) return;
      const same = speakingRef.current === message.id;
      speaker.stop();
      if (!same) speaker.say(message.content, { key: voiceKeyOf(message), id: message.id });
    },
    [speaker]
  );

  return { supported, enabled, toggle, speakingId, speakMessage };
}
