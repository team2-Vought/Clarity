import { useSyncExternalStore } from 'react';
import { elevatorMusic } from '../utils/elevatorMusic';

/** Стан музики ліфта: { enabled, muted, active, ducked, playing }. */
export function useElevatorMusic() {
  return useSyncExternalStore(elevatorMusic.subscribe, elevatorMusic.getSnapshot, elevatorMusic.getSnapshot);
}
