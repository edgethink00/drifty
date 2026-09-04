import { useCallback, useRef, useState } from "react";
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
  readonly includeBuiltInHeuristics?: boolean;
  readonly builtInHeuristicsUnavailableSince?: string | null;
  readonly classificationAssessmentReady?: boolean;
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
  const {
    windowEndDay,
    startOfDayMinutes,
    includeAiClassifications,
    includeBuiltInHeuristics,
    builtInHeuristicsUnavailableSince,
    classificationAssessmentReady = true,
  } = input;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [detailFlags, setDetailFlags] = useState<FocusCardDetailFlags | null>(null);
  const [previewPayload, setPreviewPayload] = useState<FocusCardPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const classificationAssessmentGateRef = useRef({ ready: classificationAssessmentReady });
  if (classificationAssessmentGateRef.current.ready !== classificationAssessmentReady) {
    classificationAssessmentGateRef.current = { ready: classificationAssessmentReady };
  }

  const refresh = useCallback(async () => {
    const assessmentGate = classificationAssessmentGateRef.current;
    const [result, localPreview] = await Promise.all([
      fetchOwnFocusCard(),
      buildFocusCardPayloadFromTracker({
        windowEndDay,
        startOfDayMinutes,
        includeAiClassifications,
        includeBuiltInHeuristics,
        builtInHeuristicsUnavailableSince,
        shareCategoryBreakdown: true,
        shareHourlyPattern: true,
      }).catch(() => null),
    ]);
    const nextEnabled = result.success ? (result.data?.enabled ?? false) : false;
    const nextFlags = result.success ? (result.data?.detailFlags ?? DEFAULT_FOCUS_CARD_DETAIL_FLAGS) : DEFAULT_FOCUS_CARD_DETAIL_FLAGS;
    setEnabled(nextEnabled);
    setDetailFlags(nextFlags);
    setPreviewPayload(localPreview);
    if (result.success
      && nextEnabled
      && localPreview
      && assessmentGate.ready
      && classificationAssessmentGateRef.current === assessmentGate) {
      const published = await refreshFocusCardAggregates(localPreview);
      setError(published.success ? null : (published.error ?? "Couldn't refresh your public focus summary."));
    } else if (result.success && nextEnabled && !classificationAssessmentGateRef.current.ready) {
      setError("AI classification is paused. Your public focus summary will stay unchanged until it catches up.");
    }
  }, [builtInHeuristicsUnavailableSince, classificationAssessmentReady, includeAiClassifications, includeBuiltInHeuristics, startOfDayMinutes, windowEndDay]);

  const publishWithFlags = useCallback(async (flags: FocusCardDetailFlags) => {
    const assessmentGate = classificationAssessmentGateRef.current;
    const payload = await buildFocusCardPayloadFromTracker({
      windowEndDay,
      startOfDayMinutes,
      includeAiClassifications,
      includeBuiltInHeuristics,
      builtInHeuristicsUnavailableSince,
      ...flags,
    });
    if (!assessmentGate.ready || classificationAssessmentGateRef.current !== assessmentGate) return null;
    return publishFocusCard(payload, true);
  }, [builtInHeuristicsUnavailableSince, includeAiClassifications, includeBuiltInHeuristics, startOfDayMinutes, windowEndDay]);

  const enable = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      if (!classificationAssessmentReady) {
        setError("Reconnect AI before publishing a focus summary.");
        return false;
      }
      const result = await publishWithFlags(detailFlags ?? DEFAULT_FOCUS_CARD_DETAIL_FLAGS);
      if (!result) {
        setError("Reconnect AI before publishing a focus summary.");
        return false;
      }
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
  }, [classificationAssessmentReady, detailFlags, publishWithFlags]);

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
      if (enabled === true && !classificationAssessmentReady) {
        setError("Reconnect AI before updating your public focus summary.");
        return;
      }
      // Card live → republish so the flag and its (computed or cleared) data land together.
      // Card off → persist the flag only; enable() will compute the data under these flags.
      const result = enabled === true
        ? await publishWithFlags(nextFlags)
        : await setFocusCardDetailFlags(nextFlags);
      if (!result) {
        setError("Reconnect AI before updating your public focus summary.");
        return;
      }
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
  }, [classificationAssessmentReady, detailFlags, enabled, publishWithFlags]);

  return { enabled, busy, error, detailFlags, previewPayload, refresh, enable, disable, setDetailFlag };
}
