import { useCallback, useEffect, useState } from "react";

export const PET_OUTING_PREFERENCE_STORAGE_KEY = "drifty.pet.allowOutings.v1";
export const PET_OUTING_PREFERENCE_CHANGED_EVENT = "drifty:pet-outing-preference-changed";

function normalizePetOutingPreference(value: string | null | undefined): boolean {
  // Outings were the shipped behavior before this preference existed. Only an
  // explicit persisted opt-out changes that behavior.
  return value !== "0";
}

export function resolveInitialPetOutingPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return normalizePetOutingPreference(
      window.localStorage.getItem(PET_OUTING_PREFERENCE_STORAGE_KEY),
    );
  } catch {
    return true;
  }
}

export function persistPetOutingPreference(enabled: boolean): boolean {
  if (typeof window === "undefined") return enabled;
  try {
    window.localStorage.setItem(PET_OUTING_PREFERENCE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // The current document still gets the user's choice even when persistent
    // storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<boolean>(PET_OUTING_PREFERENCE_CHANGED_EVENT, {
    detail: enabled,
  }));
  return enabled;
}

export function subscribePetOutingPreference(
  listener: (enabled: boolean) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleChanged = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    listener(typeof detail === "boolean" ? detail : resolveInitialPetOutingPreference());
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PET_OUTING_PREFERENCE_STORAGE_KEY) return;
    listener(event.key === PET_OUTING_PREFERENCE_STORAGE_KEY
      ? normalizePetOutingPreference(event.newValue)
      : resolveInitialPetOutingPreference());
  };

  window.addEventListener(PET_OUTING_PREFERENCE_CHANGED_EVENT, handleChanged);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(PET_OUTING_PREFERENCE_CHANGED_EVENT, handleChanged);
    window.removeEventListener("storage", handleStorage);
  };
}

export function usePetOutingPreference(): readonly [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(resolveInitialPetOutingPreference);

  useEffect(() => {
    const unsubscribe = subscribePetOutingPreference(setEnabled);
    // A different webview can write between the initial render and this effect.
    // Subscribe first, then reconcile so that change cannot leave stale UI.
    setEnabled(resolveInitialPetOutingPreference());
    return unsubscribe;
  }, []);

  const updateEnabled = useCallback((nextEnabled: boolean) => {
    setEnabled(persistPetOutingPreference(nextEnabled));
  }, []);

  return [enabled, updateEnabled] as const;
}
