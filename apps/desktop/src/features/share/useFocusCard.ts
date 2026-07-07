import { useCallback, useState } from "react";
import { buildFocusCardPayloadFromTracker } from "./focusCardPublisher";
import { fetchOwnFocusCard, publishFocusCard, setFocusCardEnabled } from "./focusCardService";

// Drives the public focus card's opt-in from the Embed panel. Kept off the leaderboard
// auto-publish hot path: the card is (re)published when the user enables it and refreshed
// when the panel opens. `enabled` is null until the first status load.
export interface UseFocusCardInput {
  readonly windowEndDay: string;
  readonly startOfDayMinutes: number;
  readonly includeAiClassifications: boolean;
}

export interface FocusCardControls {
  readonly enabled: boolean | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly enable: () => Promise<boolean>;
  readonly disable: () => Promise<void>;
}

export function useFocusCard(input: UseFocusCardInput): FocusCardControls {
  const { windowEndDay, startOfDayMinutes, includeAiClassifications } = input;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await fetchOwnFocusCard();
    setEnabled(result.success ? (result.data?.enabled ?? false) : false);
  }, []);

  const enable = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const payload = await buildFocusCardPayloadFromTracker({ windowEndDay, startOfDayMinutes, includeAiClassifications });
      const result = await publishFocusCard(payload, true);
      if (!result.success) {
        setError(result.error ?? "Couldn't publish your focus card.");
        return false;
      }
      setEnabled(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [windowEndDay, startOfDayMinutes, includeAiClassifications]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await setFocusCardEnabled(false);
    if (result.success) setEnabled(false);
    else setError(result.error ?? "Couldn't update your focus card.");
    setBusy(false);
  }, []);

  return { enabled, busy, error, refresh, enable, disable };
}
