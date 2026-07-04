import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { selectFlowVisibleSegmentIds, shiftIsoDate } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange, logicalTodayIsoDate } from "../../lib/formatting";
import {
  toClassificationQueryForDay,
  type AiClassificationRunOptions,
  type AiClassificationSummary,
  type ClassificationLevel,
} from "../classification/aiClassificationService";
import type { LocalAiClassificationOptions } from "../settings/localAiClassificationOptions";
import type { FirstDayPreparationPhase } from "./FirstDayPreparationScreen";

const FIRST_DAY_PREPARATION_LOOKBACK_DAYS = 2;
// The intent is to reveal a *classified* dashboard, so we wait while today's AI
// classification keeps making progress. We only cut it short when a batch stalls
// (a genuine hang, e.g. an unauthenticated cloud call) or when the overall phase
// exceeds its cap — after which the remainder finishes in the background.
const FIRST_DAY_PREPARATION_MAX_MS = 300 * 1000; // ultimate "never trap the user" backstop
const FIRST_DAY_PREPARATION_MAX_CLASSIFY_BATCHES = 80;
const FIRST_DAY_PREPARATION_CLASSIFY_BATCH_SIZE = 10; // small batches so each call finishes fast on slow local models
const FIRST_DAY_PREPARATION_CLASSIFY_STALL_MS = 75 * 1000; // per-batch hang cutoff — generous so a slow-but-working local model (4B) isn't killed mid-batch
const FIRST_DAY_PREPARATION_CLASSIFY_NO_PROGRESS_LIMIT = 4; // give up only after this many consecutive no-save batches
// Onboarding classifies at "normal" granularity (one AI call per domain+title signature,
// fanned out to matching segments) — ~fine accuracy at meaningfully fewer AI calls.
const FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL: ClassificationLevel = "normal";
// The dashboard flow chart's default zoom draws one block per 3-minute bucket. We reveal once
// every segment the chart actually shows at this zoom is classified, rather than after the
// whole day — so the visible surface is done without waiting on the non-visible tail.
const FIRST_DAY_PREPARATION_FLOW_INTERVAL_MINUTES = 3 as const;
// Cap for scanning a day's still-unclassified pool when measuring visible-set progress; a
// single logical day stays well under this.
const FIRST_DAY_PREPARATION_UNCLASSIFIED_SCAN_LIMIT = 5000;
// Just after the logical day rolls over (start-of-day, e.g. 4am) "today" is nearly
// empty, so the gate completes the most recent logical day that actually has data.
const FIRST_DAY_PREPARATION_MIN_MEANINGFUL_SEGMENTS = 15;
// Offset 0 re-runs the revealed target day to mop up anything the (time-capped)
// foreground gate left unclassified; -1/-2 cover the rest of the imported window.
const FIRST_DAY_PREPARATION_BACKGROUND_DAY_OFFSETS = [0, -1, -2] as const;

// Resolve with `fallback` if `promise` has not settled within `ms`. Used so a
// hung AI classification request can never trap the user on the loading screen.
function firstDayPreparationRaceTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

type RunAiClassificationBatch = (
  query: ReturnType<typeof toClassificationQueryForDay>,
  batchSize?: number,
  options?: AiClassificationRunOptions,
) => Promise<AiClassificationSummary>;

type RefreshDashboard = (
  day?: string,
  options?: { readonly requireCurrentSnapshot?: boolean; readonly foreground?: boolean },
) => Promise<boolean>;

export type UseFirstDayPreparationOptions = {
  readonly preparingFirstDay: boolean;
  readonly canUseCloudAiClassification: boolean;
  readonly localAiClassificationOptions: LocalAiClassificationOptions | null;
  readonly shouldBlockLocalTrackerAccess: boolean;
  readonly startOfDayMinutes: number;
  readonly selectedDayRef: MutableRefObject<string>;
  readonly clearLocalActivityCaches: () => void;
  /** Ends the gate and reveals the dashboard (e.g. `setPreparingFirstDay(false)`). */
  readonly onReveal: () => void;
  readonly refresh: RefreshDashboard;
  readonly selectDay: (day: string, options?: { readonly userSelected?: boolean }) => void;
  readonly setPhase: (phase: FirstDayPreparationPhase) => void;
  readonly setProgress: (progress: number | null) => void;
  readonly runAiClassification: RunAiClassificationBatch;
  readonly runAiClassificationUntilEmpty: RunAiClassificationBatch;
};

// The most recent logical day (today, then yesterday, then the day before) that has
// enough segments to be worth completing before reveal. Exported for unit tests.
export async function resolveFirstDayTargetDay(logicalToday: string): Promise<string> {
  for (const day of [logicalToday, shiftIsoDate(logicalToday, -1), shiftIsoDate(logicalToday, -2)]) {
    try {
      const metrics = await trackerClient.getClassificationMetrics(toClassificationQueryForDay(day));
      if (metrics.totalSegments >= FIRST_DAY_PREPARATION_MIN_MEANINGFUL_SEGMENTS) return day;
    } catch {
      // best-effort; fall through to the next candidate
    }
  }
  return logicalToday;
}

// First-day preparation gate: after opted-in onboarding, import the last 48h of
// browser history and finish classifying *today* before revealing the dashboard.
// Older days within the window are left to a background pass so the reveal is fast.
export function useFirstDayPreparation({
  canUseCloudAiClassification,
  clearLocalActivityCaches,
  localAiClassificationOptions,
  onReveal,
  preparingFirstDay,
  refresh,
  runAiClassification,
  runAiClassificationUntilEmpty,
  selectDay,
  selectedDayRef,
  setPhase,
  setProgress,
  shouldBlockLocalTrackerAccess,
  startOfDayMinutes,
}: UseFirstDayPreparationOptions): { readonly rearm: () => void } {
  const runRef = useRef(false);

  // Re-arms the one-shot gate so the next `preparingFirstDay: true` starts a fresh run
  // (used when onboarding completes again, e.g. re-running onboarding from Dev mode).
  const rearm = useCallback(() => {
    runRef.current = false;
  }, []);

  useEffect(() => {
    if (!preparingFirstDay) return;
    if (runRef.current) return;
    runRef.current = true;

    let settled = false;
    const reveal = () => {
      if (settled) return;
      settled = true;
      onReveal();
    };
    const safetyTimeout = setTimeout(reveal, FIRST_DAY_PREPARATION_MAX_MS);

    const runClassificationForDay = (day: string) => {
      const query = toClassificationQueryForDay(day);
      return localAiClassificationOptions
        ? runAiClassificationUntilEmpty(query, undefined, { ...localAiClassificationOptions, level: FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL })
        : runAiClassificationUntilEmpty(query, undefined, { level: FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL });
    };

    // Resolve the flow chart's visible segment set for `day` at the default 3-minute zoom.
    // Reveal is gated on this set, so we classify (and report progress against) exactly the
    // segments the dashboard will draw — not the whole day. Falls back to the whole day if the
    // timeline can't be read, so a fetch failure never blocks classification.
    const resolveVisibleSegmentIds = async (day: string): Promise<string[]> => {
      try {
        const segments = await trackerClient.getTimeline(getLogicalDayRange(day, day, startOfDayMinutes));
        return Array.from(
          selectFlowVisibleSegmentIds(segments, day, FIRST_DAY_PREPARATION_FLOW_INTERVAL_MINUTES, undefined, startOfDayMinutes),
        );
      } catch {
        return [];
      }
    };

    // Classify a single day one batch at a time, prioritizing the flow chart's visible set, so
    // the loading screen can report real progress (classified-in-set / set-size) and the loop
    // ends — revealing the dashboard — as soon as every visible block is classified.
    const classifyTodayWithProgress = async (day: string) => {
      const dayQuery = toClassificationQueryForDay(day);
      const visibleIds = await resolveVisibleSegmentIds(day);
      const visibleSet = new Set(visibleIds);
      // With a visible set, the batch selection is restricted to it (allow-list); the loop then
      // stops once those are done. Without one, fall back to classifying the whole day.
      const query = visibleSet.size > 0 ? { ...dayQuery, segmentIds: visibleIds } : dayQuery;

      const reportProgress = async () => {
        try {
          if (visibleSet.size > 0) {
            const remaining = await trackerClient.getUnclassifiedSegments({
              ...dayQuery,
              limit: FIRST_DAY_PREPARATION_UNCLASSIFIED_SCAN_LIMIT,
            });
            const remainingInSet = remaining.reduce((count, segment) => (visibleSet.has(segment.id) ? count + 1 : count), 0);
            const classifiedInSet = Math.max(0, visibleSet.size - remainingInSet);
            setProgress(Math.min(1, classifiedInSet / visibleSet.size));
            return;
          }
          const metrics = await trackerClient.getClassificationMetrics(dayQuery);
          if (metrics.totalSegments > 0) {
            setProgress(Math.min(1, metrics.classifiedSegments / metrics.totalSegments));
          }
        } catch {
          // progress is best-effort; never let it interrupt classification
        }
      };
      await reportProgress();
      const batchTimeoutSummary: AiClassificationSummary = {
        status: "error",
        selectedSegments: 0,
        savedRecords: 0,
        message: "Classification timed out.",
      };
      let consecutiveNoProgress = 0;
      // Single-flight: at most ONE runAiClassification call is ever in flight. When a
      // batch outlives its stall window we count no-progress but keep waiting on the
      // SAME pending promise on the next iteration (with a fresh window) instead of
      // stacking a second call on top of a slow local model, which used to pile up
      // duplicate same-day classification work.
      let pendingBatch: Promise<AiClassificationSummary> | null = null;
      for (let batch = 0; batch < FIRST_DAY_PREPARATION_MAX_CLASSIFY_BATCHES; batch += 1) {
        // Small batches so each call finishes fast; a single stalled/failed batch is
        // treated as a hang after the timeout but does NOT abandon the rest — we keep
        // going until nothing is left or several no-progress batches in a row.
        if (!pendingBatch) {
          pendingBatch = localAiClassificationOptions
            ? runAiClassification(query, FIRST_DAY_PREPARATION_CLASSIFY_BATCH_SIZE, { ...localAiClassificationOptions, level: FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL })
            : runAiClassification(query, FIRST_DAY_PREPARATION_CLASSIFY_BATCH_SIZE, { level: FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL });
        }
        const summary = await firstDayPreparationRaceTimeout(
          pendingBatch,
          FIRST_DAY_PREPARATION_CLASSIFY_STALL_MS,
          batchTimeoutSummary,
        );
        await reportProgress();
        // A timed-out batch returns the fabricated `batchTimeoutSummary` (selectedSegments: 0).
        // Do NOT treat that as "nothing left" — only a real empty result ends the loop.
        const timedOut = summary === batchTimeoutSummary;
        // Only a real settle frees the single-flight slot; the next iteration then
        // processes its real summary and may launch a fresh batch.
        if (!timedOut) pendingBatch = null;
        if (summary.status === "disabled") break; // AI off
        if (!timedOut && summary.selectedSegments === 0) break; // genuinely nothing left
        if (!timedOut && summary.savedRecords > 0) {
          consecutiveNoProgress = 0;
          continue;
        }
        consecutiveNoProgress += 1;
        if (consecutiveNoProgress >= FIRST_DAY_PREPARATION_CLASSIFY_NO_PROGRESS_LIMIT) break;
      }
      // A batch still pending at loop exit is abandoned fire-and-forget: its eventual
      // save is harmless because the background mop-up re-covers this day, and the
      // no-op catch keeps a late rejection from surfacing as unhandled.
      if (pendingBatch) void pendingBatch.catch(() => undefined);
      // No forced 100%: the progress bar reflects real classified/total coverage.
      await reportProgress();
    };

    void (async () => {
      let today = logicalTodayIsoDate(startOfDayMinutes);
      const aiAvailable = Boolean(localAiClassificationOptions) || canUseCloudAiClassification;
      try {
        if (!shouldBlockLocalTrackerAccess) {
          setPhase("importing");
          setProgress(null);
          const preview = await trackerClient.previewBrowserHistoryImport({ lookbackDays: FIRST_DAY_PREPARATION_LOOKBACK_DAYS });
          if (preview.segmentCount > 0) {
            await trackerClient.importBrowserHistory({ lookbackDays: FIRST_DAY_PREPARATION_LOOKBACK_DAYS });
            clearLocalActivityCaches();
          }
          // Complete + reveal the most recent logical day that has data, and open the
          // dashboard there — right after the day rolls over "today" is often empty.
          today = await resolveFirstDayTargetDay(today);
          // Not a user choice: the gate may land on yesterday when today is still empty,
          // and the dashboard must still auto-return to today after the next rollover.
          selectDay(today, { userSelected: false });
          // refresh() materializes and persists the day's built-in heuristic classifications,
          // so nothing renders as bare "unclassified" even before AI runs.
          await refresh(today, { foreground: true });

          if (aiAvailable && !settled) {
            setPhase("classifying");
            // Intent: reveal a fully-classified *today*. Wait until today's segments are
            // all classified (the loop exits when nothing is left). The only escape hatches
            // are a genuinely stalled/hung provider and the overall safety backstop below.
            await classifyTodayWithProgress(today);
            await refresh(today);
          }
        }
      } catch {
        // Never trap the user on the loading screen; reveal with whatever we have.
      } finally {
        clearTimeout(safetyTimeout);
        reveal();
      }

      // Background: classify the rest of the 48h window without blocking the reveal.
      if (aiAvailable && !shouldBlockLocalTrackerAccess) {
        void (async () => {
          for (const offset of FIRST_DAY_PREPARATION_BACKGROUND_DAY_OFFSETS) {
            const day = shiftIsoDate(today, offset);
            try {
              const summary = await runClassificationForDay(day);
              if (summary.savedRecords > 0 && selectedDayRef.current === day) await refresh(day);
            } catch {
              // best-effort background classification
            }
          }
        })();
      }
    })();

    return () => {
      clearTimeout(safetyTimeout);
    };
    // Intentionally keyed only on `preparingFirstDay`: this is a one-shot run guarded
    // by runRef, and re-running on other dep changes would clear the safety-reveal
    // timeout mid-flight and could trap the user on the loading screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparingFirstDay]);

  return { rearm };
}
