import { useSyncExternalStore } from 'react';
import { getVision, subscribeVision } from '../utils/vision';

/** Поточні налаштування режиму для слабозорих; оновлюється й зі змін в інших вкладках. */
export const useVision = () => useSyncExternalStore(subscribeVision, getVision, getVision);
