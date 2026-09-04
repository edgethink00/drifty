// Background publisher for the account activity summary. While active, it periodically
// builds the aggregate from the local tracker and upserts it to Supabase so drifty.so's
// account page stays fresh — dedup/backoff/heartbeat decisions live in
// accountStatsPublishState so the cycle itself stays dumb.
//
// Trigger model mirrors the leaderboard auto-publish effect (startup + interval + window
// focus + visibility). Day rollover needs no dedicated effect: the cycle recomputes
// `windowEndDay` from the clock on every run, so the first interval/focus tick after
// midnight publishes the new day's window.
import { useCallback, useEffect, useRef } from "react";
import { shouldUsePreviewData } from "../../lib/api/previewData";
import { logicalTodayIsoDate } from "../../lib/formatting";
import { buildAccountStatsPayloadFromTracker } from "./accountStatsPayload";
import {
  buildAccountStatsPayloadKey,
  findAccountStatsPublishRecord,
  readAccountStatsPublishRecords,
  recordAccountStatsPublishAttempt,
  shouldPublishAccountStats,
} from "./accountStatsPublishState";
import { publishAccountStats } from "./accountStatsService";

/** How often the recurring timer re-runs a cycle while the app stays open. */
export const ACCOUNT_STATS_CYCLE_INTERVAL_MS = 30 * 60 * 1000;

export interface UseAccountStatsPublisherInput {
  /** Master gate: Dev toggle on + cloud online + Supabase configured + signed in. */
  readonly active: boolean;
  readonly userScopeKey: string;
  readonly startOfDayMinutes: number;
  readonly includeAiClassifications: boolean;
  readonly includeBuiltInHeuristics?: boolean;
  readonly builtInHeuristicsUnavailableSince?: string | null;
}

export function useAccountStatsPublisher(input: UseAccountStatsPublisherInput): void {
  const { active, userScopeKey, startOfDayMinutes, includeAiClassifications, includeBuiltInHeuristics, builtInHeuristicsUnavailableSince } = input;
  const inFlightRef = useRef(false);
  const publicationContextKey = JSON.stringify([
    active,
    userScopeKey,
    startOfDayMinutes,
    includeAiClassifications,
    includeBuiltInHeuristics ?? null,
    builtInHeuristicsUnavailableSince ?? null,
  ]);
  const publicationContextRef = useRef({ active, key: publicationContextKey });
  if (publicationContextRef.current.key !== publicationContextKey) {
    publicationContextRef.current = { active, key: publicationContextKey };
  }

  const runCycle = useCallback(async () => {
    const publicationContext = publicationContextRef.current;
    if (!publicationContext.active || shouldUsePreviewData() || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      // Recomputed every run so day rollover is picked up by the next trigger.
      const windowEndDay = logicalTodayIsoDate(startOfDayMinutes);
      const payload = await buildAccountStatsPayloadFromTracker({
        windowEndDay,
        startOfDayMinutes,
        includeAiClassifications,
        includeBuiltInHeuristics,
        builtInHeuristicsUnavailableSince,
      });
      if (publicationContextRef.current !== publicationContext) return;
      const payloadKey = buildAccountStatsPayloadKey(payload);
      const record = findAccountStatsPublishRecord(readAccountStatsPublishRecords(), userScopeKey);
      const decision = shouldPublishAccountStats({ record, payloadKey, now: new Date() });
      if (!decision.shouldPublish) return;

      if (publicationContextRef.current !== publicationContext) return;
      const result = await publishAccountStats(payload);
      recordAccountStatsPublishAttempt({ userScopeKey, payloadKey, success: result.success, now: new Date() });
    } catch {
      // Tracker/build failures: no state write — the next trigger simply retries.
    } finally {
      inFlightRef.current = false;
    }
  }, [builtInHeuristicsUnavailableSince, includeAiClassifications, includeBuiltInHeuristics, startOfDayMinutes, userScopeKey]);

  useEffect(() => {
    // Preview/demo surfaces never publish; skip mounting the timer and listeners entirely.
    if (!active || shouldUsePreviewData()) return undefined;
    const effectPublicationContext = publicationContextRef.current;

    void runCycle();
    const intervalId = window.setInterval(() => {
      void runCycle();
    }, ACCOUNT_STATS_CYCLE_INTERVAL_MS);

    function handleFocus() {
      void runCycle();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void runCycle();
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      // Invalidate an in-flight build on unmount even if `active` never had a
      // chance to render false.
      if (publicationContextRef.current === effectPublicationContext) {
        publicationContextRef.current = { active: false, key: `${effectPublicationContext.key}:disposed` };
      }
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [active, runCycle]);
}
