import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { decodeMemoryStatus, type MemoryStatus } from "../screen-context/memoryWire";

/**
 * Set while this computer may have automatic memory switched on. Turning the
 * beta off then switches memory itself off once, without binding the screen
 * context account at every launch for people who never used memory.
 */
export const MEMORY_MAY_BE_ON_STORAGE_KEY = "drifty.memory.mayBeOn";
/**
 * Set after the first check on this computer. Memory switched on before the
 * beta gate existed left no marker, so each install checks once.
 */
export const MEMORY_GATE_CHECKED_STORAGE_KEY = "drifty.memory.gateChecked.v1";

export function noteMemoryMayBeOn(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(MEMORY_MAY_BE_ON_STORAGE_KEY, "1");
    else window.localStorage.removeItem(MEMORY_MAY_BE_ON_STORAGE_KEY);
  } catch {
    // A denied write only means the next hidden launch checks again.
  }
}

export function memoryMayBeOn(): boolean {
  try {
    return window.localStorage.getItem(MEMORY_MAY_BE_ON_STORAGE_KEY) === "1"
      || window.localStorage.getItem(MEMORY_GATE_CHECKED_STORAGE_KEY) !== "1";
  } catch { return true; }
}

function noteGateChecked(): void {
  try { window.localStorage.setItem(MEMORY_GATE_CHECKED_STORAGE_KEY, "1"); } catch {
    // The next hidden launch checks again.
  }
}

/** Switch memory off for the bound account, keeping its other choices. Resolves true when it was on. */
export async function turnMemoryOff(client: ScreenContextClient): Promise<boolean> {
  let preferences: MemoryStatus["preferences"] | null = null;
  await client.consume("memory_get_status", {}, decodeMemoryStatus, (value) => { preferences = value.preferences; });
  const current = preferences as MemoryStatus["preferences"] | null;
  if (!current?.enabled) return false;
  await client.mutate("memory_configure", { preferences: { ...current, enabled: false }, acknowledgeExternalText: false }, () => true, () => {});
  return true;
}

/**
 * While the beta is closed, nothing hidden may keep capturing or sending text:
 * switch memory off for the account that may have it on.
 */
export function useMemoryOffWhileHidden(client: ScreenContextClient, hidden: boolean): void {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const running = useRef(false);
  useEffect(() => {
    if (!hidden || !client.isDesktop() || running.current || !memoryMayBeOn()) return;
    running.current = true;
    void turnMemoryOff(client)
      .then(() => { noteMemoryMayBeOn(false); noteGateChecked(); })
      .catch(() => undefined)
      .finally(() => { running.current = false; });
  }, [client, hidden, snapshot.generation]);
}
