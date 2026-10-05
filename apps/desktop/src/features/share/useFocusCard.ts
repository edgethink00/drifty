import { useCallback, useEffect, useRef, useState } from "react";
import { buildFocusCardPayloadFromTracker } from "./focusCardPublisher";
import type { FocusCardPayload } from "./focusCardPublisher";
import {
  DEFAULT_FOCUS_CARD_DETAIL_FLAGS,
  captureFocusCardConsent,
  fetchOwnFocusCard,
  publishFocusCard,
  refreshFocusCardAggregates,
  setFocusCardDetailFlags,
  setFocusCardEnabled,
} from "./focusCardService";
import type { FocusCardDetailFlags } from "./focusCardService";

// Drives the public focus card's opt-in from the Embed panel. Kept off the leaderboard
// auto-publish hot path: the card is (re)published when the user enables it and refreshed
// when the panel opens or local history is deleted. `enabled` is null until the first status load.
//
// Detail opt-ins (category breakdown / hourly rhythm) live on the SERVER row —
// it is the single source of truth, so the get_focus_card gate and the publisher can never
// disagree about what the user consented to. `detailFlags` is null until the first load.
export interface UseFocusCardInput {
  readonly userId: string | null;
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
    userId,
    windowEndDay,
    startOfDayMinutes,
    includeAiClassifications,
    includeBuiltInHeuristics,
    builtInHeuristicsUnavailableSince,
    classificationAssessmentReady = true,
  } = input;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [detailFlags, setDetailFlags] = useState<FocusCardDetailFlags | null>(null);
  const [consentRevision, setConsentRevision] = useState<string | null>(null);
  const [previewPayload, setPreviewPayload] = useState<FocusCardPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationQueuesRef = useRef(new Map<string | null, Promise<void>>());
  const consentQueuesRef = useRef(new Map<string | null, Promise<void>>());
  const pendingWithdrawalsRef = useRef(new Map<string | null, object>());
  const refreshSequenceRef = useRef(0);
  const consentIntentRef = useRef(0);
  const ownerScopeRef = useRef({ userId });
  if (ownerScopeRef.current.userId !== userId) {
    ownerScopeRef.current = { userId };
    consentIntentRef.current += 1;
    refreshSequenceRef.current += 1;
  }
  const ownerScope = ownerScopeRef.current;
  const [stateScope, setStateScope] = useState(ownerScope);
  const isCurrentOwner = useCallback(() => Boolean(ownerScope.userId)
    && ownerScopeRef.current === ownerScope, [ownerScope]);
  const hasCurrentState = stateScope === ownerScope;
  const currentEnabled = hasCurrentState ? enabled : null;
  const currentFlags = hasCurrentState ? detailFlags : null;
  const currentRevision = hasCurrentState ? consentRevision : null;
  useEffect(() => {
    if (stateScope === ownerScope) return;
    setStateScope(ownerScope);
    setEnabled(null);
    setDetailFlags(null);
    setConsentRevision(null);
    setPreviewPayload(null);
    setBusy(false);
    setError(null);
  }, [ownerScope, stateScope]);
  // Refreshes wait for earlier aggregate writes, so an old publication cannot
  // restore deleted totals. Explicit publications keep their existing timing
  // (including detail withdrawal) and register completion before later refreshes.
  const runOperation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const previous = operationQueuesRef.current.get(ownerScope.userId) ?? Promise.resolve();
    const queued = previous.then(operation, operation);
    operationQueuesRef.current.set(ownerScope.userId, queued.then(() => undefined, () => undefined));
    return queued;
  }, [ownerScope]);
  const registerConsentWrite = useCallback((written: Promise<unknown>, previous: Promise<void> | undefined) => {
    // An earlier read must not restore flags/enable state after a new explicit
    // consent choice, even when that write does not wait for the read.
    refreshSequenceRef.current += 1;
    const tail = written.then(() => undefined, () => undefined);
    consentQueuesRef.current.set(ownerScope.userId, tail);
    void tail.then(() => {
      if (consentQueuesRef.current.get(ownerScope.userId) === tail) consentQueuesRef.current.delete(ownerScope.userId);
    });
    operationQueuesRef.current.set(ownerScope.userId, Promise.allSettled([previous, written]).then(() => undefined));
  }, [ownerScope]);
  const runPublication = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const previous = operationQueuesRef.current.get(ownerScope.userId);
    const earlierConsent = consentQueuesRef.current.get(ownerScope.userId);
    // Consent writes must keep their order, including A -> B -> A. Aggregate
    // refreshes do not delay an explicit detail withdrawal or disable.
    const published = earlierConsent ? earlierConsent.then(operation, operation) : operation();
    registerConsentWrite(published, previous);
    return published;
  }, [ownerScope, registerConsentWrite]);
  const classificationAssessmentGateRef = useRef({ ready: classificationAssessmentReady });
  if (classificationAssessmentGateRef.current.ready !== classificationAssessmentReady) {
    classificationAssessmentGateRef.current = { ready: classificationAssessmentReady };
  }

  const refresh = useCallback(() => {
    if (!isCurrentOwner()) return Promise.resolve();
    const sequence = ++refreshSequenceRef.current;
    const assessmentGate = classificationAssessmentGateRef.current;
    return runOperation(async () => {
      if (!isCurrentOwner() || sequence !== refreshSequenceRef.current) return;
      const withdrawal = pendingWithdrawalsRef.current.get(ownerScope.userId);
      if (withdrawal) {
        const disabled = await setFocusCardEnabled(false, undefined, ownerScope.userId);
        if (disabled.success && pendingWithdrawalsRef.current.get(ownerScope.userId) === withdrawal) {
          pendingWithdrawalsRef.current.delete(ownerScope.userId);
        }
        if (!isCurrentOwner() || sequence !== refreshSequenceRef.current) return;
        if (!disabled.success) {
          setError(disabled.error ?? "Couldn't update your focus card.");
          return;
        }
      }
      const [result, localPreview] = await Promise.all([
        fetchOwnFocusCard(undefined, ownerScope.userId),
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
      // A newer deletion can arrive while the old payload is being built.
      if (!isCurrentOwner() || sequence !== refreshSequenceRef.current) return;
      const nextEnabled = result.success ? (result.data?.enabled ?? false) : false;
      const nextFlags = result.success ? (result.data?.detailFlags ?? DEFAULT_FOCUS_CARD_DETAIL_FLAGS) : DEFAULT_FOCUS_CARD_DETAIL_FLAGS;
      setEnabled(nextEnabled);
      setDetailFlags(nextFlags);
      setConsentRevision(result.success
        ? (result.data ? result.data.consentRevision : "00000000-0000-0000-0000-000000000000")
        : null);
      setPreviewPayload(localPreview);
      if (result.success
        && nextEnabled
        && localPreview
        && assessmentGate.ready
        && classificationAssessmentGateRef.current === assessmentGate) {
        const published = await refreshFocusCardAggregates(localPreview, undefined, ownerScope.userId);
        if (isCurrentOwner() && sequence === refreshSequenceRef.current) {
          setError(published.success ? null : (published.error ?? "Couldn't refresh your public focus summary."));
        }
      } else if (result.success && nextEnabled && !classificationAssessmentGateRef.current.ready) {
        setError("AI classification is paused. Your public focus summary will stay unchanged until it catches up.");
      }
    });
  }, [builtInHeuristicsUnavailableSince, classificationAssessmentReady, includeAiClassifications, includeBuiltInHeuristics, isCurrentOwner, ownerScope, runOperation, startOfDayMinutes, windowEndDay]);

  const publishWithFlags = useCallback((flags: FocusCardDetailFlags) => {
    if (!isCurrentOwner()) return Promise.resolve(null);
    const assessmentGate = classificationAssessmentGateRef.current;
    const intent = ++consentIntentRef.current;
    const consent = captureFocusCardConsent(undefined, ownerScope.userId, { enabled: currentEnabled, detailFlags: currentFlags, consentRevision: currentRevision });
    return runPublication(async () => {
      const captured = await consent;
      if (!isCurrentOwner() || intent !== consentIntentRef.current) return null;
      if (!captured.success || !captured.data) return { success: false, error: captured.error };
      const payload = await buildFocusCardPayloadFromTracker({
        windowEndDay,
        startOfDayMinutes,
        includeAiClassifications,
        includeBuiltInHeuristics,
        builtInHeuristicsUnavailableSince,
        ...flags,
      });
      if (!isCurrentOwner() || intent !== consentIntentRef.current || !assessmentGate.ready || classificationAssessmentGateRef.current !== assessmentGate) return null;
      return publishFocusCard(payload, true, undefined, ownerScope.userId, captured.data);
    });
  }, [builtInHeuristicsUnavailableSince, currentEnabled, currentFlags, currentRevision, includeAiClassifications, includeBuiltInHeuristics, isCurrentOwner, ownerScope, runPublication, startOfDayMinutes, windowEndDay]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!isCurrentOwner()) return false;
    setBusy(true);
    setError(null);
    const withdrawalBeforeEnable = pendingWithdrawalsRef.current.get(ownerScope.userId);
    try {
      if (!classificationAssessmentReady) {
        setError("Reconnect AI before publishing a focus summary.");
        return false;
      }
      const result = await publishWithFlags(currentFlags ?? DEFAULT_FOCUS_CARD_DETAIL_FLAGS);
      // A successful explicit enable supersedes only the withdrawal it started
      // after. Never clear a newer disable just because an old response arrives.
      if (result?.success && pendingWithdrawalsRef.current.get(ownerScope.userId) === withdrawalBeforeEnable) {
        pendingWithdrawalsRef.current.delete(ownerScope.userId);
      }
      if (!isCurrentOwner()) return false;
      if (!result) {
        setError("Reconnect AI before publishing a focus summary.");
        return false;
      }
      if (!result.success) {
        setError(result.error ?? "Couldn't publish your focus card.");
        return false;
      }
      setEnabled(true);
      setConsentRevision(result.data ?? null);
      return true;
    } catch (err) {
      if (isCurrentOwner()) setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      if (isCurrentOwner()) setBusy(false);
    }
  }, [classificationAssessmentReady, currentFlags, isCurrentOwner, ownerScope, publishWithFlags]);

  const disable = useCallback((): Promise<void> => {
    if (!isCurrentOwner()) return Promise.resolve();
    setBusy(true);
    setError(null);
    consentIntentRef.current += 1;
    const withdrawal = {};
    pendingWithdrawalsRef.current.set(ownerScope.userId, withdrawal);
    const earlierConsent = consentQueuesRef.current.get(ownerScope.userId);
    const previous = operationQueuesRef.current.get(ownerScope.userId);
    const disabled = (async () => {
      try {
        // Withdraw immediately; an already-submitted enable may land later.
        let result = await setFocusCardEnabled(false, undefined, ownerScope.userId);
        if (isCurrentOwner() && result.success) { setEnabled(false); setConsentRevision(result.data ?? null); }
        if (earlierConsent) {
          await earlierConsent;
          // The original withdrawal still belongs to this account. Auth is
          // checked in the service; no other account can receive this write.
          result = await setFocusCardEnabled(false, undefined, ownerScope.userId);
        }
        if (result.success && pendingWithdrawalsRef.current.get(ownerScope.userId) === withdrawal) {
          pendingWithdrawalsRef.current.delete(ownerScope.userId);
        }
        if (!isCurrentOwner()) return;
        if (result.success) { setEnabled(false); setConsentRevision(result.data ?? null); setError(null); }
        else setError(result.error ?? "Couldn't update your focus card.");
      } catch (err) {
        if (isCurrentOwner()) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isCurrentOwner()) setBusy(false);
      }
    })();
    // If auth changed before the final withdrawal, keep its intent and retry
    // before the originating account's next refresh. New consent waits for it.
    registerConsentWrite(disabled, previous);
    return disabled;
  }, [isCurrentOwner, ownerScope, registerConsentWrite]);

  const setDetailFlag = useCallback(async (flag: keyof FocusCardDetailFlags, value: boolean) => {
    if (!isCurrentOwner()) return;
    const detailIntent = ++consentIntentRef.current;
    const consent = currentEnabled === true ? null : captureFocusCardConsent(undefined, ownerScope.userId, { enabled: currentEnabled, detailFlags: currentFlags, consentRevision: currentRevision });
    const nextFlags: FocusCardDetailFlags = { ...(currentFlags ?? DEFAULT_FOCUS_CARD_DETAIL_FLAGS), [flag]: value };
    setBusy(true);
    setError(null);
    try {
      if (currentEnabled === true && !classificationAssessmentReady) {
        setError("Reconnect AI before updating your public focus summary.");
        return;
      }
      // Card live → republish so the flag and its (computed or cleared) data land together.
      // Card off → persist the flag only; enable() will compute the data under these flags.
      const result = currentEnabled === true
        ? await publishWithFlags(nextFlags)
        : await runPublication(async () => {
          const captured = await consent;
          if (!isCurrentOwner() || detailIntent !== consentIntentRef.current) return null;
          if (!captured?.success || !captured.data) return { success: false, error: captured?.error ?? "Couldn't verify Focus Card sharing." };
          return setFocusCardDetailFlags(nextFlags, undefined, ownerScope.userId, captured.data);
        });
      if (!isCurrentOwner()) return;
      if (!result) {
        setError("Reconnect AI before updating your public focus summary.");
        return;
      }
      if (!result.success) {
        setError(result.error ?? "Couldn't update your focus card.");
        return;
      }
      setDetailFlags(nextFlags);
      setConsentRevision(result.data ?? null);
    } catch (err) {
      if (isCurrentOwner()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrentOwner()) setBusy(false);
    }
  }, [classificationAssessmentReady, currentFlags, currentEnabled, currentRevision, isCurrentOwner, ownerScope, publishWithFlags, runPublication]);

  return {
    enabled: currentEnabled, busy: hasCurrentState ? busy : false,
    error: hasCurrentState ? error : null, detailFlags: currentFlags,
    previewPayload: hasCurrentState ? previewPayload : null,
    refresh, enable, disable, setDetailFlag,
  };
}
