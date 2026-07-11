import { useCallback, useState } from "react";
import { buildFocusCardPayloadFromTracker } from "./focusCardPublisher";
import type { FocusCardPayload } from "./focusCardPublisher";
import {
  DEFAULT_FOCUS_CARD_DETAIL_FLAGS,
  fetchOwnFocusCard,
  publishFocusCard,
  refreshFocusCardAggregates,
  setFocusCardDetailFlags,
  setFocusCardEnabled,
} from "./focusCardService";
import type { FocusCardDetailFlags } from "./focusCardService";

// Drives the public focus card's opt-in from the Embed panel. Kept off the leaderboard
// auto-publish hot path: the card is (re)published when the user enables it and refreshed
// when the panel opens. `enabled` is null until the first status load.
//
// Detail opt-ins (category breakdown / hourly rhythm) live on the SERVER row —
// it is the single source of truth, so the get_focus_card gate and the publisher can never
// disagree about what the user consented to. `detailFlags` is null until the first load.
export interface UseFocusCardInput {
  readonly windowEndDay: string;
  readonly startOfDayMinutes: number;
  readonly includeAiClassifications: boolean;
}

export interface FocusCardControls {
  readonly enabled: boolean | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly detailFlags: FocusCardDetailFlags | null;
  /** Locally computed only; lets Profile show exactly what would be shared before consent. */
  readonly previewPayload?: FocusCardPayload | null;
  readonly refresh: () => Promise<void>;
  readonly enable: () => Promise<boolean>;
  readonly disable: () => Promise<void>;
  readonly setDetailFlag: (flag: keyof FocusCardDetailFlags, value: boolean) => Promise<void>;
}

export function useFocusCard(input: UseFocusCardInput): FocusCardControls {
  const { windowEndDay, startOfDayMinutes, includeAiClassifications } = input;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [detailFlags, setDetailFlags] = useState<FocusCardDetailFlags | null>(null);
  const [previewPayload, setPreviewPayload] = useState<FocusCardPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [result, localPreview] = await Promise.all([
      fetchOwnFocusCard(),
      buildFocusCardPayloadFromTracker({
        windowEndDay,
        startOfDayMinutes,
        includeAiClassifications,
        shareCategoryBreakdown: true,
        shareHourlyPattern: true,
      }).catch(() => null),
    ]);
    const nextEnabled = result.success ? (result.data?.enabled ?? false) : false;
    const nextFlags = result.success ? (result.data?.detailFlags ?? DEFAULT_FOCUS_CARD_DETAIL_FLAGS) : DEFAULT_FOCUS_CARD_DETAIL_FLAGS;
    setEnabled(nextEnabled);
    setDetailFlags(nextFlags);
    setPreviewPayload(localPreview);
    if (result.success && nextEnabled && localPreview) {
      const published = await refreshFocusCardAggregates(localPreview);
      setError(published.success ? null : (published.error ?? "Couldn't refresh your public focus summary."));
    }
  }, [windowEndDay, startOfDayMinutes, includeAiClassifications]);

  const publishWithFlags = useCallback(async (flags: FocusCardDetailFlags) => {
    const payload = await buildFocusCardPayloadFromTracker({
      windowEndDay,
      startOfDayMinutes,
      includeAiClassifications,
      ...flags,
    });
    return publishFocusCard(payload, true);
  }, [windowEndDay, startOfDayMinutes, includeAiClassifications]);

  const enable = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const result = await publishWithFlags(detailFlags ?? DEFAULT_FOCUS_CARD_DETAIL_FLAGS);
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
  }, [detailFlags, publishWithFlags]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await setFocusCardEnabled(false);
    if (result.success) setEnabled(false);
    else setError(result.error ?? "Couldn't update your focus card.");
    setBusy(false);
  }, []);

  const setDetailFlag = useCallback(async (flag: keyof FocusCardDetailFlags, value: boolean) => {
    const nextFlags: FocusCardDetailFlags = { ...(detailFlags ?? DEFAULT_FOCUS_CARD_DETAIL_FLAGS), [flag]: value };
    setBusy(true);
    setError(null);
    try {
      // Card live → republish so the flag and its (computed or cleared) data land together.
      // Card off → persist the flag only; enable() will compute the data under these flags.
      const result = enabled === true
        ? await publishWithFlags(nextFlags)
        : await setFocusCardDetailFlags(nextFlags);
      if (!result.success) {
        setError(result.error ?? "Couldn't update your focus card.");
        return;
      }
      setDetailFlags(nextFlags);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detailFlags, enabled, publishWithFlags]);

  return { enabled, busy, error, detailFlags, previewPayload, refresh, enable, disable, setDetailFlag };
}
