import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

type UsePetModeVisibilityRequestsResult = {
  readonly petModeRevealRevision: number;
  readonly requestPetModeEnabled: (enabled: boolean) => boolean;
  readonly togglePetModeEnabled: () => boolean;
};

/**
 * Preserve explicit user intent separately from the persisted preference.
 *
 * Some controller paths can enqueue off/on requests in one React batch before
 * the native synchronization Effect observes the intermediate state. The
 * reveal revision still changes in that case, giving the native layer an
 * unambiguous "show it now" request instead of treating the final `true` as a
 * no-op.
 */
export function usePetModeVisibilityRequests(
  petModeEnabled: boolean,
  setPetModeEnabled: Dispatch<SetStateAction<boolean>>,
  onReveal?: () => void,
): UsePetModeVisibilityRequestsResult {
  const requestedEnabledRef = useRef(petModeEnabled);
  const [petModeRevealRevision, setPetModeRevealRevision] = useState(0);

  useEffect(() => {
    requestedEnabledRef.current = petModeEnabled;
  }, [petModeEnabled]);

  const requestPetModeEnabled = useCallback((enabled: boolean) => {
    requestedEnabledRef.current = enabled;
    setPetModeEnabled(enabled);
    if (enabled) {
      onReveal?.();
      setPetModeRevealRevision((revision) => revision + 1);
    }
    return enabled;
  }, [onReveal, setPetModeEnabled]);

  const togglePetModeEnabled = useCallback(() => {
    const enabled = !requestedEnabledRef.current;
    requestedEnabledRef.current = enabled;
    setPetModeEnabled(enabled);
    if (enabled) {
      onReveal?.();
      setPetModeRevealRevision((revision) => revision + 1);
    }
    return enabled;
  }, [onReveal, setPetModeEnabled]);

  return {
    petModeRevealRevision,
    requestPetModeEnabled,
    togglePetModeEnabled,
  };
}
