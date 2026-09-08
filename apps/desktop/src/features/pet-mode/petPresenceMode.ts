import { useCallback, useEffect, useState } from "react";

/**
 * How the pet occupies the screen while it is turned on.
 *
 * - `always`: the resident cat that ships by default. It lives on screen and
 *   occasionally walks off for an outing.
 * - `drift_only`: the cat waits at the screen edge with only its tail
 *   showing, walks in when a drift episode escalates, and walks back out once
 *   focus has held for a while. Off is not a mode here; it stays the separate
 *   `petModeEnabled` preference so the two never disagree about the window.
 */
export type PetPresenceMode = "always" | "drift_only";

export const PET_PRESENCE_MODE_STORAGE_KEY = "drifty.pet.presenceMode.v1";
export const PET_PRESENCE_MODE_CHANGED_EVENT = "drifty:pet-presence-mode-changed";
/** One-time nudge shown the first time the pet menu's Turn Off is chosen. */
export const PET_TURN_OFF_SUGGESTION_SEEN_STORAGE_KEY = "drifty.pet.turnOffSuggestionSeen.v1";

/** How long focus must hold after a visit before the cat walks back out. */
export const PET_PRESENCE_RETREAT_AFTER_FOCUS_MS = 2 * 60_000;
/** Grace before the first retreat so a fresh window can settle its entry. */
export const PET_PRESENCE_INITIAL_RETREAT_MS = 1_500;
/** A pat while the cat is off duty sends it back out soon after the reaction. */
export const PET_PRESENCE_DISMISS_RETREAT_MS = 4_000;

function normalizePetPresenceMode(value: string | null | undefined): PetPresenceMode {
  return value === "drift_only" ? "drift_only" : "always";
}

export function resolveInitialPetPresenceMode(): PetPresenceMode {
  if (typeof window === "undefined") return "always";
  try {
    return normalizePetPresenceMode(window.localStorage.getItem(PET_PRESENCE_MODE_STORAGE_KEY));
  } catch {
    return "always";
  }
}

export function persistPetPresenceMode(mode: PetPresenceMode): PetPresenceMode {
  if (typeof window === "undefined") return mode;
  try {
    window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, mode);
  } catch {
    // The current document still gets the user's choice even when persistent
    // storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<PetPresenceMode>(PET_PRESENCE_MODE_CHANGED_EVENT, {
    detail: mode,
  }));
  return mode;
}

export function subscribePetPresenceMode(
  listener: (mode: PetPresenceMode) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleChanged = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    listener(typeof detail === "string" ? normalizePetPresenceMode(detail) : resolveInitialPetPresenceMode());
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PET_PRESENCE_MODE_STORAGE_KEY) return;
    listener(event.key === PET_PRESENCE_MODE_STORAGE_KEY
      ? normalizePetPresenceMode(event.newValue)
      : resolveInitialPetPresenceMode());
  };

  window.addEventListener(PET_PRESENCE_MODE_CHANGED_EVENT, handleChanged);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(PET_PRESENCE_MODE_CHANGED_EVENT, handleChanged);
    window.removeEventListener("storage", handleStorage);
  };
}

export function usePetPresenceMode(): readonly [PetPresenceMode, (mode: PetPresenceMode) => void] {
  const [mode, setMode] = useState(resolveInitialPetPresenceMode);
  useEffect(() => {
    const unsubscribe = subscribePetPresenceMode(setMode);
    // A different webview can write between the initial render and this effect.
    setMode(resolveInitialPetPresenceMode());
    return unsubscribe;
  }, []);
  const update = useCallback((next: PetPresenceMode) => {
    setMode(persistPetPresenceMode(next));
  }, []);
  return [mode, update] as const;
}

export function hasSeenPetTurnOffSuggestion(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PET_TURN_OFF_SUGGESTION_SEEN_STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markPetTurnOffSuggestionSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PET_TURN_OFF_SUGGESTION_SEEN_STORAGE_KEY, "1");
  } catch {
    // Best effort; the suggestion may show once more next time.
  }
}
