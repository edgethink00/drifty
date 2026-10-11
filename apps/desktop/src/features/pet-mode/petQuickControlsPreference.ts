import { useCallback, useEffect, useState } from "react";

export const PET_QUICK_CONTROLS_PREFERENCE_STORAGE_KEY = "drifty.pet.showHoverControls.v1";
export const PET_QUICK_CONTROLS_PREFERENCE_CHANGED_EVENT = "drifty:pet-quick-controls-preference-changed";

function normalizePetQuickControlsPreference(value: string | null | undefined): boolean {
  // Hover controls were the shipped behavior before this preference existed. Only an
  // explicit persisted opt-out changes that behavior.
  return value !== "0";
}

export function resolveInitialPetQuickControlsPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return normalizePetQuickControlsPreference(
      window.localStorage.getItem(PET_QUICK_CONTROLS_PREFERENCE_STORAGE_KEY),
    );
  } catch {
    return true;
  }
}

export function persistPetQuickControlsPreference(enabled: boolean): boolean {
  if (typeof window === "undefined") return enabled;
  try {
    window.localStorage.setItem(PET_QUICK_CONTROLS_PREFERENCE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // The current document still gets the user's choice even when persistent
    // storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<boolean>(PET_QUICK_CONTROLS_PREFERENCE_CHANGED_EVENT, {
    detail: enabled,
  }));
  return enabled;
}

export function subscribePetQuickControlsPreference(
  listener: (enabled: boolean) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleChanged = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    listener(typeof detail === "boolean" ? detail : resolveInitialPetQuickControlsPreference());
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PET_QUICK_CONTROLS_PREFERENCE_STORAGE_KEY) return;
    listener(event.key === PET_QUICK_CONTROLS_PREFERENCE_STORAGE_KEY
      ? normalizePetQuickControlsPreference(event.newValue)
      : resolveInitialPetQuickControlsPreference());
  };

  window.addEventListener(PET_QUICK_CONTROLS_PREFERENCE_CHANGED_EVENT, handleChanged);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(PET_QUICK_CONTROLS_PREFERENCE_CHANGED_EVENT, handleChanged);
    window.removeEventListener("storage", handleStorage);
  };
}

export function usePetQuickControlsPreference(): readonly [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(resolveInitialPetQuickControlsPreference);

  useEffect(() => {
    const unsubscribe = subscribePetQuickControlsPreference(setEnabled);
    // A different webview can write between the initial render and this effect.
    // Subscribe first, then reconcile so that change cannot leave stale UI.
    setEnabled(resolveInitialPetQuickControlsPreference());
    return unsubscribe;
  }, []);

  const updateEnabled = useCallback((nextEnabled: boolean) => {
    setEnabled(persistPetQuickControlsPreference(nextEnabled));
  }, []);

  return [enabled, updateEnabled] as const;
}
