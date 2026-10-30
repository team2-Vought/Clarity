import { useCallback, useEffect, useState } from 'react';
import {
  NOTIFY_PREFS_EVENT,
  enableSystemNotify,
  notificationPermission,
  readSound,
  readSystemNotify,
  writeSound,
  writeSystemNotify,
} from '../utils/notify';

const snapshot = () => ({
  sound: readSound(),
  system: readSystemNotify(),
  permission: notificationPermission(),
});

/** Налаштування сповіщень цього пристрою; однакові в сайдбарі, налаштуваннях і чаті. */
export function useNotifyPrefs() {
  const [prefs, setPrefs] = useState(snapshot);

  useEffect(() => {
    const update = () => setPrefs(snapshot());
    window.addEventListener(NOTIFY_PREFS_EVENT, update);
    // дозвіл могли змінити в налаштуваннях браузера, поки вкладка була у фоні
    window.addEventListener('focus', update);
    return () => {
      window.removeEventListener(NOTIFY_PREFS_EVENT, update);
      window.removeEventListener('focus', update);
    };
  }, []);

  const setSound = useCallback((on) => writeSound(on), []);

  const setSystem = useCallback(async (on) => {
    if (!on) {
      writeSystemNotify(false);
      return 'off';
    }
    return enableSystemNotify();
  }, []);

  return { ...prefs, setSound, setSystem };
}
