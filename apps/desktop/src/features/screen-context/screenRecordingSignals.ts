import { useSyncExternalStore } from "react";

type Signal = { readonly get: () => boolean; readonly set: (next: boolean) => void; readonly subscribe: (listener: () => void) => () => void };
function signal(): Signal {
  let value = false;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => { if (value === next) return; value = next; listeners.forEach((listener) => listener()); },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** Whether this install can record at all, learned from the last status read. Unknown counts as no. */
export const screenRecordingAvailable = signal();
/** Whether recording was ever turned on here. Activity deletion only mentions saved screens then. */
export const screenRecordingUsed = signal();

export function useScreenRecordingAvailable(): boolean {
  return useSyncExternalStore(screenRecordingAvailable.subscribe, screenRecordingAvailable.get, () => false);
}
export function useScreenRecordingUsed(): boolean {
  return useSyncExternalStore(screenRecordingUsed.subscribe, screenRecordingUsed.get, () => false);
}
