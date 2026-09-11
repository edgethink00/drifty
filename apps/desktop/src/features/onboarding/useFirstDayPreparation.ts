import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { shiftIsoDate } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import {
  toCountBucket,
  toFirstDayPreparationDurationBucket,
  toFirstDayPreparationSegmentCountBucket,
} from "../../lib/analytics/eventHelpers";
import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import { logicalTodayIsoDate } from "../../lib/formatting";
import {
  describeAiClassificationFailure,
  toClassificationQueryForDay,
  type AiClassificationRunOptions,
  type AiClassificationQuotaWindow,
  type AiClassificationSummary,
  type ClassificationLevel,
} from "../classification/aiClassificationService";
import { getManagedLocalAiStatus } from "../settings/managedLocalAiClient";
import { ensureManagedLocalAiReady } from "../classification/managedLocalAiChat";
import type { LocalAiClassificationOptions } from "../settings/localAiClassificationOptions";
import type {
  FirstDayPreparationFailureReason,
  FirstDayPreparationPhase,
} from "./FirstDayPreparationScreen";

const FIRST_DAY_PREPARATION_LOOKBACK_DAYS = 2;
// The intent is to reveal a *classified* dashboard, so we wait while today's AI
// classification keeps making progress. We only cut it short when a batch stalls
// (a genuine hang, e.g. an unauthenticated cloud call) or when the overall phase
// exceeds its cap — after which the remainder finishes in the background.
export const FIRST_DAY_PREPARATION_MAX_MS = 300 * 1000; // ultimate "never trap the user" backstop
const FIRST_DAY_PREPARATION_MAX_CLASSIFY_BATCHES = 80;
const FIRST_DAY_PREPARATION_CLASSIFY_BATCH_SIZE = 10; // small batches so each call finishes fast on slow local models
const FIRST_DAY_PREPARATION_CLASSIFY_STALL_MS = 75 * 1000; // per-batch hang cutoff — generous so a slow-but-working local model (4B) isn't killed mid-batch
const FIRST_DAY_PREPARATION_CLASSIFY_NO_PROGRESS_LIMIT = 4; // give up only after this many consecutive no-save batches
export const FIRST_DAY_PREPARATION_TRANSIENT_FAILURE_LIMIT = 3;
export const FIRST_DAY_PREPARATION_RETRY_BASE_MS = 1_000;
// Wait from the server denial instead of guessing its fixed-minute boundary
// from the client clock; this remains safe when the two clocks differ.
const FIRST_DAY_PREPARATION_MINUTE_QUOTA_RETRY_MS = 60_000;
// Onboarding classifies at "normal" granularity (one AI call per domain+title signature,
// fanned out to matching segments) — ~fine accuracy at meaningfully fewer AI calls.
const FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL: ClassificationLevel = "normal";
// Just after the logical day rolls over (start-of-day, e.g. 4am) "today" is nearly
// empty, so the gate completes the most recent logical day that actually has data.
const FIRST_DAY_PREPARATION_MIN_MEANINGFUL_SEGMENTS = 15;
// The selected day is fully classified before reveal. Background work only
// covers the two older days in the imported window.
const FIRST_DAY_PREPARATION_BACKGROUND_DAY_OFFSETS = [-1, -2] as const;
// Poll cadence for the in-gate managed-model download wait; download progress
// feeds the loading bar, so keep it responsive.
const FIRST_DAY_PREPARATION_DOWNLOAD_POLL_MS = 1_500;
// After a (time-capped) reveal, the background pass keeps waiting for a managed
// model that is still downloading before classifying — slower poll, generous cap.
const FIRST_DAY_PREPARATION_BACKGROUND_MODEL_POLL_MS = 5_000;
const FIRST_DAY_PREPARATION_BACKGROUND_MODEL_WAIT_MS = 60 * 60 * 1000;
export const FIRST_DAY_PREPARATION_CLOUD_READY_WAIT_MS = 30 * 1000;
const FIRST_DAY_PREPARATION_CLOUD_READY_POLL_MS = 500;

// Resolve with `fallback` if `promise` has not settled within `ms`. Used so a
// hung AI classification request can never trap the user on the loading screen.
function firstDayPreparationRaceTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function firstDayPreparationDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  readonly browserHistoryImportEnabled: boolean;
  /** Live entitlement/auth readiness; it can flip while the one-shot gate runs. */
  readonly canUseCloudAiClassificationRef: MutableRefObject<boolean>;
  /** True when onboarding selected Drifty Cloud, even while readiness is settling. */
  readonly cloudAiSelected: boolean;
  /**
   * Live view of the local AI options. The managed-model attach watcher fills the
   * AI setup while the gate runs, so the gate reads this ref instead of a snapshot.
   */
  readonly localAiClassificationOptionsRef: MutableRefObject<LocalAiClassificationOptions | null>;
  /** True when the user picked managed Local AI (its download may still be running). */
  readonly managedLocalSelected: boolean;
  readonly shouldBlockLocalTrackerAccess: boolean;
  readonly startOfDayMinutes: number;
  readonly selectedDayRef: MutableRefObject<string>;
  readonly clearLocalActivityCaches: () => void;
  /**
   * Ends the gate and reveals the dashboard (e.g. `setPreparingFirstDay(false)`).
   * `complete` means the day was actually prepared and has earned a closing beat;
   * `continue` means the user chose to move on from a paused run, where a
   * congratulatory finish would be a lie.
   */
  readonly onReveal: (outcome: "complete" | "continue") => void;
  readonly refresh: RefreshDashboard;
  readonly selectDay: (day: string, options?: { readonly userSelected?: boolean }) => void;
  readonly setPhase: (phase: FirstDayPreparationPhase) => void;
  readonly setProgress: (progress: number | null) => void;
  readonly runAiClassification: RunAiClassificationBatch;
  readonly runAiClassificationUntilEmpty: RunAiClassificationBatch;
  readonly selectedAiProviderKeyRef: MutableRefObject<string>;
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
  browserHistoryImportEnabled,
  canUseCloudAiClassificationRef,
  clearLocalActivityCaches,
  cloudAiSelected,
  localAiClassificationOptionsRef,
  managedLocalSelected,
  onReveal,
  preparingFirstDay,
  refresh,
  runAiClassification,
  runAiClassificationUntilEmpty,
  selectedAiProviderKeyRef,
  selectDay,
  selectedDayRef,
  setPhase,
  setProgress,
  shouldBlockLocalTrackerAccess,
  startOfDayMinutes,
}: UseFirstDayPreparationOptions): {
  readonly continueAnyway: () => void;
  readonly failure: FirstDayPreparationFailureReason | null;
  readonly rearm: () => void;
  readonly retry: () => void;
} {
  const runRef = useRef(false);
  const foregroundBatchRef = useRef<{
    readonly day: string;
    readonly localProvider: AiClassificationRunOptions["localProvider"];
    readonly promise: Promise<AiClassificationSummary>;
  } | null>(null);
  const [failure, setFailure] = useState<FirstDayPreparationFailureReason | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);

  // Re-arms the one-shot gate so the next `preparingFirstDay: true` starts a fresh run
  // (used when onboarding completes again, e.g. re-running onboarding from Dev mode).
  const rearm = useCallback(() => {
    runRef.current = false;
    setFailure(null);
  }, []);

  const retry = useCallback(() => {
    runRef.current = false;
    setFailure(null);
    setRetryRevision((revision) => revision + 1);
  }, []);

  const continueAnyway = useCallback(() => {
    setFailure(null);
    onReveal("continue");
  }, [onReveal]);

  useEffect(() => {
    if (!preparingFirstDay) return;
    if (runRef.current) return;
    runRef.current = true;

    let settled = false;
    let cancelled = false;
    let revealed = false;
    const attemptStartedAt = Date.now();
    let quotaWaitCount = 0;
    let lastQuotaWindow: AiClassificationQuotaWindow | null = null;
    let initialSegmentCount: number | null = null;
    let remainingSegmentCount: number | null = null;
    const selectedProviderKeyAtStart = selectedAiProviderKeyRef.current;
    const selectedProviderUnchanged = () => selectedAiProviderKeyRef.current === selectedProviderKeyAtStart;
    const providerKind = () => {
      const localProvider = localAiClassificationOptionsRef.current?.localProvider.provider;
      if (localProvider === "managed_local") return "local" as const;
      if (localProvider === "openrouter_byok" || localProvider === "self_hosted") return "custom" as const;
      if (managedLocalSelected) return "local" as const;
      if (cloudAiSelected && canUseCloudAiClassificationRef.current) return "cloud" as const;
      return "none" as const;
    };
    const captureOutcome = (outcome: "success" | FirstDayPreparationFailureReason) => {
      try {
        capturePostHogEvent("first_day_preparation", {
          provider_kind: providerKind(),
          outcome,
          ...(lastQuotaWindow ? { quota_window: lastQuotaWindow } : {}),
          quota_wait_count_bucket: toCountBucket(quotaWaitCount),
          duration_bucket: toFirstDayPreparationDurationBucket(Date.now() - attemptStartedAt),
          ...(initialSegmentCount === null ? {} : {
            initial_segment_count_bucket: toFirstDayPreparationSegmentCountBucket(initialSegmentCount),
          }),
          ...(remainingSegmentCount === null ? {} : {
            remaining_segment_count_bucket: toFirstDayPreparationSegmentCountBucket(remainingSegmentCount),
          }),
        });
      } catch {
        // Analytics is best-effort and must never block the dashboard reveal or retry UI.
      }
    };
    const reveal = () => {
      if (settled || cancelled) return;
      settled = true;
      revealed = true;
      setFailure(null);
      onReveal("complete");
      captureOutcome("success");
    };
    const fail = (reason: FirstDayPreparationFailureReason, detail?: unknown) => {
      if (settled || cancelled) return;
      settled = true;
      if (detail) console.warn("First-day preparation paused", detail);
      setFailure(reason);
      captureOutcome(reason);
    };
    const safetyTimeout = setTimeout(
      () => fail("preparation_timed_out"),
      FIRST_DAY_PREPARATION_MAX_MS,
    );

    const runClassificationForDay = (day: string, classifyOptions: LocalAiClassificationOptions | null) => {
      const query = toClassificationQueryForDay(day);
      return classifyOptions
        ? runAiClassificationUntilEmpty(query, undefined, { ...classifyOptions, level: FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL })
        : runAiClassificationUntilEmpty(query, undefined, { level: FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL });
    };

    // Wait for a managed local model that onboarding left downloading. The app-level
    // attach watcher fills the AI setup when the download lands; here we surface the
    // download progress on the loading bar and hand back the options once they exist.
    // Bails when there is genuinely nothing to wait for (no download, or it failed).
    const waitForManagedModelOptions = async (): Promise<LocalAiClassificationOptions | null> => {
      while (!settled && !cancelled && selectedProviderUnchanged()) {
        const options = localAiClassificationOptionsRef.current;
        if (options) return options;
        try {
          const status = await getManagedLocalAiStatus();
          if (status.state === "error") return null;
          if (status.state === "not_installed" && !status.selectedModelId) return null;
          setProgress(status.progress ? Math.min(1, Math.max(0, status.progress.percent / 100)) : null);
        } catch (error) {
          // status is best-effort; keep waiting on the options ref
        }
        await firstDayPreparationDelay(FIRST_DAY_PREPARATION_DOWNLOAD_POLL_MS);
      }
      return localAiClassificationOptionsRef.current;
    };

    // Same wait after the reveal, without progress reporting: the dashboard is
    // already visible, so a long download only delays the background fill-in.
    const waitForManagedModelInBackground = async (): Promise<LocalAiClassificationOptions | null> => {
      const deadline = Date.now() + FIRST_DAY_PREPARATION_BACKGROUND_MODEL_WAIT_MS;
      while (!cancelled && selectedProviderUnchanged() && Date.now() < deadline) {
        const options = localAiClassificationOptionsRef.current;
        if (options) return options;
        try {
          const status = await getManagedLocalAiStatus();
          if (status.state === "error") return null;
          if (status.state === "not_installed" && !status.selectedModelId) return null;
        } catch {
          // keep waiting on the options ref
        }
        await firstDayPreparationDelay(FIRST_DAY_PREPARATION_BACKGROUND_MODEL_POLL_MS);
      }
      return localAiClassificationOptionsRef.current;
    };

    const waitForCloudAiAvailability = async (): Promise<boolean> => {
      const deadline = Date.now() + FIRST_DAY_PREPARATION_CLOUD_READY_WAIT_MS;
      while (!settled && !cancelled && selectedProviderUnchanged() && Date.now() < deadline) {
        if (canUseCloudAiClassificationRef.current) return true;
        await firstDayPreparationDelay(FIRST_DAY_PREPARATION_CLOUD_READY_POLL_MS);
      }
      return canUseCloudAiClassificationRef.current;
    };

    // Classify the entire selected logical day. Completion is checked against
    // the whole-day query, never the flow chart's currently visible subset.
    const classifyTodayWithProgress = async (
      day: string,
      classifyOptions: LocalAiClassificationOptions | null,
    ): Promise<boolean> => {
      const dayQuery = toClassificationQueryForDay(day);

      const applyProgress = (metrics: Awaited<ReturnType<typeof trackerClient.getClassificationMetrics>>) => {
        if (initialSegmentCount === null) initialSegmentCount = metrics.totalSegments;
        remainingSegmentCount = metrics.unclassifiedSegments;
        if (metrics.totalSegments > 0) {
          setProgress(Math.min(1, metrics.classifiedSegments / metrics.totalSegments));
        }
      };
      const reportProgress = async () => {
        try {
          const metrics = await trackerClient.getClassificationMetrics(dayQuery);
          applyProgress(metrics);
          return metrics;
        } catch {
          return null;
        }
      };
      const initialMetrics = await reportProgress();
      if (initialMetrics?.unclassifiedSegments === 0) return true;
      const batchTimeoutSummary: AiClassificationSummary = {
        status: "error",
        selectedSegments: 0,
        savedRecords: 0,
        message: "Classification timed out.",
        failureKind: "transport",
      };
      let consecutiveNoProgress = 0;
      let consecutiveTransientFailures = 0;
      // Single-flight: at most ONE runAiClassification call is ever in flight. When a
      // batch outlives its stall window we count no-progress but keep waiting on the
      // SAME pending promise on the next iteration (with a fresh window) instead of
      // stacking a second call on top of a slow local model, which used to pile up
      // duplicate same-day classification work.
      const localProvider = classifyOptions?.localProvider ?? null;
      const existingBatch = foregroundBatchRef.current;
      let pendingBatch = existingBatch?.day === day && existingBatch.localProvider === localProvider
        ? existingBatch.promise
        : null;
      for (let batch = 0; batch < FIRST_DAY_PREPARATION_MAX_CLASSIFY_BATCHES; batch += 1) {
        if (settled || cancelled) break;
        // Small batches so each call finishes fast; a single stalled/failed batch is
        // treated as a hang after the timeout but does NOT abandon the rest — we keep
        // going until nothing is left or several no-progress batches in a row.
        if (!pendingBatch) {
          const nextBatch = classifyOptions
            ? runAiClassification(dayQuery, FIRST_DAY_PREPARATION_CLASSIFY_BATCH_SIZE, { ...classifyOptions, level: FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL })
            : runAiClassification(dayQuery, FIRST_DAY_PREPARATION_CLASSIFY_BATCH_SIZE, { level: FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL });
          const entry = { day, localProvider, promise: nextBatch };
          foregroundBatchRef.current = entry;
          void nextBatch.finally(() => {
            if (foregroundBatchRef.current === entry) foregroundBatchRef.current = null;
          }).catch(() => undefined);
          pendingBatch = nextBatch;
        }
        // A rejected batch (e.g. a provider that is still coming up) counts as a
        // failed batch instead of aborting the whole gate run.
        const summary = await firstDayPreparationRaceTimeout(
          pendingBatch.catch(async (error): Promise<AiClassificationSummary> => {
            const failure = await describeAiClassificationFailure(error);
            return {
              status: "error",
              selectedSegments: 0,
              savedRecords: 0,
              ...failure,
            };
          }),
          FIRST_DAY_PREPARATION_CLASSIFY_STALL_MS,
          batchTimeoutSummary,
        );
        const nextMetrics = summary.metrics ?? await reportProgress();
        if (summary.metrics) applyProgress(summary.metrics);
        // A timed-out batch returns the fabricated `batchTimeoutSummary` (selectedSegments: 0).
        // Do NOT treat that as "nothing left" — only a real empty result ends the loop.
        const timedOut = summary === batchTimeoutSummary;
        // Only a real settle frees the single-flight slot; the next iteration then
        // processes its real summary and may launch a fresh batch.
        if (!timedOut) pendingBatch = null;
        // `empty` only means the batch selector found no eligible work. The
        // whole-day metrics are the success contract; never reveal while they
        // still report unclassified activity.
        if (nextMetrics?.unclassifiedSegments === 0) {
          setProgress(1);
          return true;
        }
        const transientFailure = timedOut
          || summary.status === "disabled"
          || (summary.status === "error" && summary.failureKind !== "content");
        if (transientFailure) {
          if (!timedOut && !classifyOptions && summary.failureKind === "quota") {
            lastQuotaWindow = summary.quotaWindow ?? "unknown";
            if (summary.quotaWindow === "minute") {
              quotaWaitCount += 1;
              await firstDayPreparationDelay(FIRST_DAY_PREPARATION_MINUTE_QUOTA_RETRY_MS);
              if (settled || cancelled) break;
              continue;
            }
            break;
          }
          consecutiveTransientFailures += 1;
          if (consecutiveTransientFailures >= FIRST_DAY_PREPARATION_TRANSIENT_FAILURE_LIMIT) break;
          if (!timedOut) {
            await firstDayPreparationDelay(
              FIRST_DAY_PREPARATION_RETRY_BASE_MS * (2 ** (consecutiveTransientFailures - 1)),
            );
          }
          continue;
        }
        if (!timedOut && summary.savedRecords > 0) {
          consecutiveNoProgress = 0;
          consecutiveTransientFailures = 0;
          continue;
        }
        consecutiveNoProgress += 1;
        if (consecutiveNoProgress >= FIRST_DAY_PREPARATION_CLASSIFY_NO_PROGRESS_LIMIT) break;
      }
      // A batch still pending at loop exit is abandoned fire-and-forget: its eventual
      // save is harmless because the background mop-up re-covers this day, and the
      // no-op catch keeps a late rejection from surfacing as unhandled.
      if (pendingBatch) void pendingBatch.catch(() => undefined);
      await reportProgress();
      return false;
    };

    void (async () => {
      let today = logicalTodayIsoDate(startOfDayMinutes);
      // Managed Local AI counts as "available" even while its download is still
      // running — the gate waits for it (phase "downloading") instead of skipping AI.
      const aiCouldBecomeAvailable = Boolean(localAiClassificationOptionsRef.current)
        || cloudAiSelected
        || managedLocalSelected;
      try {
        if (shouldBlockLocalTrackerAccess) {
          fail("classification_incomplete", "Local tracker access is blocked.");
          return;
        }

        if (browserHistoryImportEnabled) {
          setPhase("importing");
          setProgress(null);
          try {
            const preview = await trackerClient.previewBrowserHistoryImport({ lookbackDays: FIRST_DAY_PREPARATION_LOOKBACK_DAYS });
            if (preview.segmentCount > 0) {
              await trackerClient.importBrowserHistory({ lookbackDays: FIRST_DAY_PREPARATION_LOOKBACK_DAYS });
              clearLocalActivityCaches();
            }
          } catch (error) {
            // Import is optional reconstruction. Continue with activity the
            // tracker already has instead of treating it as a Cloud failure.
            console.warn("First-day browser history import unavailable", error);
          }
        }
        // Complete + reveal the most recent logical day that has data, and open the
        // dashboard there — right after the day rolls over "today" is often empty.
        today = await resolveFirstDayTargetDay(today);
        selectDay(today, { userSelected: false });
        await refresh(today, { foreground: true });

        if (aiCouldBecomeAvailable && !settled) {
          let classifyOptions = localAiClassificationOptionsRef.current;
          if (!classifyOptions && !canUseCloudAiClassificationRef.current && managedLocalSelected) {
            setPhase("downloading");
            setProgress(null);
            classifyOptions = await waitForManagedModelOptions();
            if (!classifyOptions && !settled) {
              fail("classification_incomplete", "The selected local model did not become ready.");
              return;
            }
          }
          if (!classifyOptions && cloudAiSelected && !canUseCloudAiClassificationRef.current && !settled) {
            setPhase("classifying");
            setProgress(null);
            const cloudReady = await waitForCloudAiAvailability();
            if (!cloudReady && !settled) {
              fail("cloud_not_ready");
              return;
            }
          }

          if (classifyOptions?.localProvider.provider === "managed_local" && !settled) {
            setPhase("downloading");
            try {
              await ensureManagedLocalAiReady(classifyOptions.localProvider.modelId);
            } catch (error) {
              // Classification below confirms readiness with bounded retries.
              console.warn("Managed local AI warmup did not complete", error);
            }
          }
          if (!selectedProviderUnchanged() && !settled) {
            fail("classification_incomplete", "The selected AI provider changed during preparation.");
            return;
          }
          if ((classifyOptions || (cloudAiSelected && canUseCloudAiClassificationRef.current)) && !settled) {
            setPhase("classifying");
            setProgress(null);
            const complete = await classifyTodayWithProgress(today, classifyOptions);
            if (!complete && !settled) {
              fail("classification_incomplete");
              return;
            }
            if (!settled) await refresh(today);
          } else if (!settled) {
            fail("classification_incomplete", "The selected AI route is unavailable.");
            return;
          }
        }
      } catch (error) {
        fail("classification_incomplete", error);
      }

      clearTimeout(safetyTimeout);
      if (!settled) reveal();

      // Background: classify the rest of the 48h window without blocking the reveal.
      // A managed model that outlived the gate's backstop is awaited here, so the
      // revealed (heuristic) dashboard still fills in with AI classifications.
      if (revealed && aiCouldBecomeAvailable && !shouldBlockLocalTrackerAccess) {
        void (async () => {
          if (!selectedProviderUnchanged()) return;
          let backgroundOptions = localAiClassificationOptionsRef.current;
          if (!backgroundOptions && !canUseCloudAiClassificationRef.current && managedLocalSelected) {
            backgroundOptions = await waitForManagedModelInBackground();
            if (!backgroundOptions) return;
          }
          if (!backgroundOptions && !(cloudAiSelected && canUseCloudAiClassificationRef.current)) return;
          for (const offset of FIRST_DAY_PREPARATION_BACKGROUND_DAY_OFFSETS) {
            if (cancelled || !selectedProviderUnchanged()) return;
            const day = shiftIsoDate(today, offset);
            try {
              const summary = await runClassificationForDay(day, backgroundOptions);
              if (summary.savedRecords > 0 && selectedDayRef.current === day) await refresh(day);
            } catch {
              // best-effort background classification
            }
          }
        })();
      }
    })();

    return () => {
      if (!revealed) cancelled = true;
      clearTimeout(safetyTimeout);
    };
    // Retrying is the only dependency besides the gate itself that starts a new
    // attempt; live readiness is read through refs to avoid cancelling mid-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparingFirstDay, retryRevision]);

  return { continueAnyway, failure, rearm, retry };
}
