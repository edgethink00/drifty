import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { shiftIsoDate } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { toAnalyticsErrorKind, toCountBucket, toFirstDayPreparationDurationBucket, toFirstDayPreparationSegmentCountBucket, toFirstDayPreparationStageDurationBucket, type AnalyticsErrorKind } from "../../lib/analytics/eventHelpers";
import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import { logicalTodayIsoDate } from "../../lib/formatting";
import { FIRST_RUN_BROWSER_HISTORY_LOOKBACK_DAYS } from "../../lib/browserHistoryImportWindow";
import { FIRST_DAY_RECAP_MIN_CLASSIFIED_SECONDS, firstDayRecordedSeconds } from "./firstDayStory";
import { getClassificationActivitySnapshot } from "../classification/classificationActivity";
import {
  describeAiClassificationFailure,
  toClassificationQueryForDay,
  type AiClassificationRunOptions,
  type AiClassificationCloudErrorType,
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
import {
  beginFirstDayCloudBacklog,
  clearFirstDayCloudBacklog,
  readFirstDayCloudBacklog,
  releaseFirstDayCloudBacklog,
  updateFirstDayCloudBacklog,
} from "./firstDayCloudBacklog";

const FIRST_DAY_PREPARATION_LOOKBACK_DAYS = FIRST_RUN_BROWSER_HISTORY_LOOKBACK_DAYS;
// Local-model preparation may keep working for longer; Cloud's quota-paced
// first day has a short foreground budget and continues after dashboard reveal.
export const FIRST_DAY_PREPARATION_MAX_MS = 300 * 1000;
export const FIRST_DAY_PREPARATION_CLOUD_MAX_MS = 45 * 1000;
const FIRST_DAY_PREPARATION_MAX_CLASSIFY_BATCHES = 80;
const FIRST_DAY_PREPARATION_CLASSIFY_BATCH_SIZE = 10; // small batches so each call finishes fast on slow local models
const FIRST_DAY_PREPARATION_CLASSIFY_STALL_MS = 75 * 1000; // per-batch hang cutoff — generous so a slow-but-working local model (4B) isn't killed mid-batch
const FIRST_DAY_PREPARATION_CLASSIFY_NO_PROGRESS_LIMIT = 4; // give up only after this many consecutive no-save batches
// Background reloads that let classified icons land during the wait start at least this far apart, so a
// run of near-instant batches (cached or deterministic results) cannot hammer the tracker with reloads.
export const FIRST_DAY_PREPARATION_LIVE_REFRESH_MIN_GAP_MS = 1_000;
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
// A fully prepared day leaves only these older days; a partial Cloud reveal
// also adds the selected day to the background pass.
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
const FIRST_DAY_PREPARATION_BACKGROUND_RETRY_MAX_MS = 60 * 1000;

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

function cloudQuotaRetryDelay(window: AiClassificationQuotaWindow | undefined): number {
  if (window === "day") return Math.max(60_000, new Date().setUTCHours(24, 1, 0, 0) - Date.now());
  if (window === "hour") return 60 * 60 * 1000;
  return FIRST_DAY_PREPARATION_MINUTE_QUOTA_RETRY_MS;
}

function cloudBackgroundRetryDelay(consecutiveFailures: number): number {
  return Math.min(
    FIRST_DAY_PREPARATION_BACKGROUND_RETRY_MAX_MS,
    FIRST_DAY_PREPARATION_RETRY_BASE_MS * (2 ** Math.min(consecutiveFailures - 1, 6)),
  );
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
  readonly cloudBacklogOwnerId?: string | null;
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
  /** Restores the dashboard's one-shot import attempt if this import fails. */
  readonly onBrowserHistoryImportFailed: () => void;
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
  /**
   * Segment ids the in-flight foreground batch sent to the AI provider, so the screen can name what
   * is being read; an empty list once the batch settles. Local display only.
   */
  readonly setReadingSegmentIds?: (segmentIds: readonly string[]) => void;
  /** The logical day this run prepares, once chosen; null while it is still being chosen. */
  readonly setPreparedDay?: (day: string | null) => void;
  readonly runAiClassification: RunAiClassificationBatch;
  readonly runAiClassificationUntilEmpty: RunAiClassificationBatch;
  readonly selectedAiProviderKeyRef: MutableRefObject<string>;
};

// The day first-run prepares and the intro tells: yesterday first, because a whole finished day
// reads as "your day" while today is still partial at install time; then today, then the day before.
// A candidate is chosen by the time it holds as well as its segment count, so a day of many short
// visits does not win over a later day that can actually tell a story, and a day of a few long visits
// is not skipped. In order: the first day with both enough segments and enough recorded time, else the
// first with enough recorded time, else the first with enough segments (the earlier rule), else today.
// The recorded-time floor is the recap's classified minimum: a day under it cannot open the story.
// Exported for unit tests.
export async function resolveFirstDayTargetDay(logicalToday: string, startOfDayMinutes = 0): Promise<string> {
  const candidates = [shiftIsoDate(logicalToday, -1), logicalToday, shiftIsoDate(logicalToday, -2)];
  const facts = await Promise.all(candidates.map(async (day) => {
    const [segmentCount, recordedSeconds] = await Promise.all([
      trackerClient.getClassificationMetrics(toClassificationQueryForDay(day))
        .then((metrics) => metrics.totalSegments)
        .catch(() => null),
      trackerClient.getTimeline({ day })
        .then((segments) => firstDayRecordedSeconds({ segments, day, startOfDayMinutes }))
        .catch(() => null),
    ]);
    return { day, segmentCount, recordedSeconds };
  }));
  type DayFacts = (typeof facts)[number];
  const enoughSegments = (facts: DayFacts) => facts.segmentCount !== null && facts.segmentCount >= FIRST_DAY_PREPARATION_MIN_MEANINGFUL_SEGMENTS;
  const enoughTime = (facts: DayFacts) => facts.recordedSeconds !== null && facts.recordedSeconds >= FIRST_DAY_RECAP_MIN_CLASSIFIED_SECONDS;
  const chosen = facts.find((candidate) => enoughSegments(candidate) && enoughTime(candidate))
    ?? facts.find(enoughTime)
    ?? facts.find(enoughSegments);
  return chosen?.day ?? logicalToday;
}

// First-day preparation gate: import the opted-in last 72h browser history and
// classify the selected day. Cloud quota or the short time cap reveals a partial
// dashboard and resumes the selected day in the background.
export function useFirstDayPreparation({
  browserHistoryImportEnabled,
  canUseCloudAiClassificationRef,
  clearLocalActivityCaches,
  cloudAiSelected,
  cloudBacklogOwnerId,
  localAiClassificationOptionsRef,
  managedLocalSelected,
  onBrowserHistoryImportFailed,
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
  setReadingSegmentIds,
  setPreparedDay,
  shouldBlockLocalTrackerAccess,
  startOfDayMinutes,
}: UseFirstDayPreparationOptions): {
  readonly continueAnyway: () => void;
  readonly failure: FirstDayPreparationFailureReason | null;
  readonly rearm: () => void;
  readonly retry: () => void;
} {
  const runRef = useRef(false);
  const runGenerationRef = useRef(0);
  const cloudBacklogRunIdRef = useRef<string | null>(null);
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
    runGenerationRef.current += 1;
    runRef.current = false;
    setFailure(null);
  }, []);

  const retry = useCallback(() => {
    runGenerationRef.current += 1;
    runRef.current = false;
    setFailure(null);
    setRetryRevision((revision) => revision + 1);
  }, []);

  const continueAnyway = useCallback(() => {
    if (cloudBacklogRunIdRef.current) releaseFirstDayCloudBacklog(cloudBacklogRunIdRef.current);
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
    let partialCloudReveal = false;
    const attemptStartedAt = Date.now();
    setPreparedDay?.(null);
    let lastQuotaWindow: AiClassificationQuotaWindow | null = null;
    let quotaWaitCount = 0;
    let lastForegroundFailure: "quota" | "transient" | "content" | null = null;
    let lastForegroundErrorKind: AnalyticsErrorKind | null = null;
    let lastCloudErrorType: AiClassificationCloudErrorType | null = null;
    let initialSegmentCount: number | null = null;
    let remainingSegmentCount: number | null = null;
    let importStartedAt: number | null = null;
    let importFinishedAt: number | null = null;
    let firstCloudRequestStartedAt: number | null = null;
    let activeCloudRequestStartedAt: number | null = null;
    let cloudRequestDurationMs = 0;
    let cloudRequestCount = 0;
    let classificationBatchCount = 0;
    const onCloudRequestTiming: NonNullable<AiClassificationRunOptions["onCloudRequestTiming"]> = (requestPhase, elapsedMs) => {
      if (requestPhase === "started") {
        const now = Date.now();
        firstCloudRequestStartedAt ??= now;
        activeCloudRequestStartedAt = now;
        cloudRequestCount += 1;
      } else {
        cloudRequestDurationMs += Math.max(0, elapsedMs);
        activeCloudRequestStartedAt = null;
      }
    };
    let currentPhase: Exclude<FirstDayPreparationPhase, "ready"> = browserHistoryImportEnabled ? "importing" : "classifying";
    const markPhase = (phase: Exclude<FirstDayPreparationPhase, "ready">) => {
      currentPhase = phase;
      setPhase(phase);
    };
    const selectedProviderKeyAtStart = selectedAiProviderKeyRef.current;
    const runGenerationAtStart = runGenerationRef.current;
    const cloudBacklog = cloudAiSelected && cloudBacklogOwnerId
      ? beginFirstDayCloudBacklog(
        cloudBacklogOwnerId,
        logicalTodayIsoDate(startOfDayMinutes),
        browserHistoryImportEnabled,
      )
      : null;
    cloudBacklogRunIdRef.current = cloudBacklog?.runId ?? null;
    const updateCloudBacklog = (changes: { readonly day?: string; readonly importPending?: boolean }) => {
      if (cloudBacklog && cloudBacklogOwnerId) {
        updateFirstDayCloudBacklog(cloudBacklogOwnerId, cloudBacklog.runId, changes);
      }
    };
    const completeCloudBacklogIfEmpty = async (day: string, source: "foreground" | "background") => {
      if (!cloudBacklog || !cloudBacklogOwnerId || !selectedProviderUnchanged()) return;
      const current = readFirstDayCloudBacklog(cloudBacklogOwnerId);
      if (!current || current.runId !== cloudBacklog.runId || current.importPending) return;
      try {
        const remaining = await trackerClient.getUnclassifiedSegments({ ...toClassificationQueryForDay(day), limit: 1 });
        if (remaining.length === 0 && clearFirstDayCloudBacklog(cloudBacklogOwnerId, cloudBacklog.runId)) {
          capturePostHogEvent("first_day_backlog", { source });
        }
      } catch {
        // Leave the marker for a later probe.
      }
    };
    const selectedProviderUnchanged = () => runGenerationRef.current === runGenerationAtStart
      && selectedAiProviderKeyRef.current === selectedProviderKeyAtStart;
    // What the screen says is being read. Cleared whenever the batch it describes is over.
    const showReading = (segmentIds: readonly string[]) => {
      if (settled || cancelled) return;
      setReadingSegmentIds?.(segmentIds);
    };
    const clearReading = () => setReadingSegmentIds?.([]);
    // Each saved batch reloads the day in the background, so the screen's icons settle as their
    // classifications are stored instead of all at once when the run ends. At most one reload is
    // in flight, reloads start at least FIRST_DAY_PREPARATION_LIVE_REFRESH_MIN_GAP_MS apart, and
    // batches that land meanwhile collapse into one more reload.
    let liveRefreshInFlight = false;
    let liveRefreshQueued = false;
    let liveRefreshStartedAt = Number.NEGATIVE_INFINITY;
    let liveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshClassifiedDay = (day: string) => {
      if (settled || cancelled) return;
      if (liveRefreshInFlight || liveRefreshTimer !== null) {
        liveRefreshQueued = true;
        return;
      }
      const wait = liveRefreshStartedAt + FIRST_DAY_PREPARATION_LIVE_REFRESH_MIN_GAP_MS - Date.now();
      if (wait > 0) {
        liveRefreshTimer = setTimeout(() => {
          liveRefreshTimer = null;
          refreshClassifiedDay(day);
        }, wait);
        return;
      }
      liveRefreshInFlight = true;
      liveRefreshQueued = false;
      liveRefreshStartedAt = Date.now();
      void refresh(day, { foreground: false })
        .catch(() => false)
        .finally(() => {
          liveRefreshInFlight = false;
          if (!liveRefreshQueued) return;
          liveRefreshQueued = false;
          refreshClassifiedDay(day);
        });
    };
    const stopLiveRefresh = () => {
      if (liveRefreshTimer !== null) clearTimeout(liveRefreshTimer);
      liveRefreshTimer = null;
      liveRefreshQueued = false;
    };
    const providerKind = () => {
      const localProvider = localAiClassificationOptionsRef.current?.localProvider.provider;
      if (localProvider === "managed_local") return "local" as const;
      if (localProvider === "openrouter_byok" || localProvider === "openai" || localProvider === "anthropic" || localProvider === "self_hosted") return "custom" as const;
      if (managedLocalSelected) return "local" as const;
      if (cloudAiSelected) return "cloud" as const;
      return "none" as const;
    };
    const captureOutcome = (
      outcome: "success" | FirstDayPreparationFailureReason,
      presentation: "dashboard_complete" | "dashboard_partial" | "retry_screen",
      errorKind: AnalyticsErrorKind | null = null,
    ) => {
      try {
        capturePostHogEvent("first_day_preparation", {
          provider_kind: providerKind(),
          outcome,
          presentation,
          ...(outcome === "success" ? {} : { phase: currentPhase }),
          ...(outcome !== "success" && lastForegroundFailure ? { failure_kind: lastForegroundFailure } : {}),
          ...(errorKind ? { error_kind: errorKind } : {}),
          ...(outcome !== "success" && lastCloudErrorType ? { cloud_error_type: lastCloudErrorType } : {}),
          ...(lastQuotaWindow ? { quota_window: lastQuotaWindow } : {}),
          quota_wait_count_bucket: toCountBucket(quotaWaitCount),
          duration_bucket: toFirstDayPreparationDurationBucket(Date.now() - attemptStartedAt),
          ...(importStartedAt === null ? {} : {
            import_duration_bucket: toFirstDayPreparationStageDurationBucket((importFinishedAt ?? Date.now()) - importStartedAt),
          }),
          ...(firstCloudRequestStartedAt === null ? {} : {
            time_to_first_cloud_request_bucket: toFirstDayPreparationStageDurationBucket(firstCloudRequestStartedAt - attemptStartedAt),
            cloud_request_duration_bucket: toFirstDayPreparationStageDurationBucket(
              cloudRequestDurationMs + (activeCloudRequestStartedAt === null ? 0 : Date.now() - activeCloudRequestStartedAt),
            ),
          }),
          cloud_request_count_bucket: toCountBucket(cloudRequestCount),
          classification_batch_count_bucket: toCountBucket(classificationBatchCount),
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
      clearReading();
      setFailure(null);
      onReveal("complete");
      captureOutcome("success", "dashboard_complete");
    };
    const revealPartialCloudDay = (reason: FirstDayPreparationFailureReason) => {
      if (settled || cancelled) return;
      settled = true;
      revealed = true;
      partialCloudReveal = true;
      clearReading();
      setFailure(null);
      onReveal("continue");
      captureOutcome(reason, "dashboard_partial", lastForegroundErrorKind);
    };
    const fail = (reason: FirstDayPreparationFailureReason, detail?: unknown) => {
      if (settled || cancelled) return;
      settled = true;
      clearReading();
      if (detail) console.warn("First-day preparation paused", detail);
      setFailure(reason);
      captureOutcome(reason, "retry_screen", detail ? toAnalyticsErrorKind(detail) : lastForegroundErrorKind);
    };
    const safetyTimeout = setTimeout(
      () => cloudAiSelected
        ? revealPartialCloudDay("preparation_timed_out")
        : fail("preparation_timed_out"),
      cloudAiSelected ? FIRST_DAY_PREPARATION_CLOUD_MAX_MS : FIRST_DAY_PREPARATION_MAX_MS,
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

    const waitForCloudInBackground = async (): Promise<boolean> => {
      const deadline = Date.now() + FIRST_DAY_PREPARATION_BACKGROUND_MODEL_WAIT_MS;
      while (!cancelled && selectedProviderUnchanged() && !canUseCloudAiClassificationRef.current && Date.now() < deadline) {
        await firstDayPreparationDelay(FIRST_DAY_PREPARATION_CLOUD_READY_POLL_MS);
      }
      return !cancelled && selectedProviderUnchanged() && canUseCloudAiClassificationRef.current;
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
          classificationBatchCount += 1;
          const nextBatch = classifyOptions
            ? runAiClassification(dayQuery, FIRST_DAY_PREPARATION_CLASSIFY_BATCH_SIZE, {
              ...classifyOptions,
              level: FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL,
              onProviderBatchStart: showReading,
            })
            : runAiClassification(dayQuery, FIRST_DAY_PREPARATION_CLASSIFY_BATCH_SIZE, {
              level: FIRST_DAY_PREPARATION_CLASSIFICATION_LEVEL,
              onCloudRequestTiming,
              onProviderBatchStart: showReading,
            });
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
        if (!timedOut) {
          pendingBatch = null;
          clearReading();
          if (summary.savedRecords > 0) refreshClassifiedDay(day);
        }
        // Metrics include synced segments from other devices, while this device's
        // candidate selector intentionally excludes them. Only local candidates
        // can keep this device's first-day preparation open.
        if (nextMetrics?.unclassifiedSegments === 0) {
          setProgress(1);
          return true;
        }
        if (summary.status === "empty") {
          const candidates = await trackerClient.getUnclassifiedSegments({ ...dayQuery, limit: 1 });
          if (candidates.length === 0) return true;
        }
        const transientFailure = timedOut
          || summary.status === "disabled"
          || (summary.status === "error" && summary.failureKind !== "content");
        if (transientFailure) {
          lastForegroundFailure = summary.failureKind === "quota" ? "quota" : "transient";
          lastCloudErrorType = summary.serverErrorType ?? null;
          lastForegroundErrorKind = timedOut
            ? "timeout"
            : summary.status === "disabled"
              ? "unavailable"
              : toAnalyticsErrorKind(summary.message);
          if (!timedOut && !classifyOptions && summary.failureKind === "quota") {
            lastQuotaWindow = summary.quotaWindow ?? "unknown";
            quotaWaitCount += 1;
            // A Cloud quota is normal pacing, not a reason to keep onboarding
            // on a 60-second foreground retry loop.
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
          lastForegroundFailure = null;
          lastForegroundErrorKind = null;
          lastCloudErrorType = null;
          consecutiveNoProgress = 0;
          consecutiveTransientFailures = 0;
          continue;
        }
        lastForegroundFailure = "content";
        lastForegroundErrorKind = toAnalyticsErrorKind(summary.message);
        lastCloudErrorType = summary.serverErrorType ?? null;
        consecutiveNoProgress += 1;
        if (consecutiveNoProgress >= FIRST_DAY_PREPARATION_CLASSIFY_NO_PROGRESS_LIMIT) break;
      }
      // A batch still pending at loop exit is abandoned fire-and-forget: its eventual
      // save is harmless because the background mop-up re-covers this day, and the
      // no-op catch keeps a late rejection from surfacing as unhandled.
      if (pendingBatch) void pendingBatch.catch(() => undefined);
      clearReading();
      await reportProgress();
      return false;
    };

    void (async () => {
      let today = logicalTodayIsoDate(startOfDayMinutes);
      // The import's oldest whole day. Background classification stops here: the import also reaches
      // into the evening of the day before it, a partial day no story or first dashboard shows.
      const oldestImportedWholeDay = shiftIsoDate(today, -2);
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
          markPhase("importing");
          setProgress(null);
          importStartedAt = Date.now();
          try {
            // Import already returns its own preview counts. A separate preview
            // copies and scans every browser database twice on the critical path.
            const result = await trackerClient.importBrowserHistory({ lookbackDays: FIRST_DAY_PREPARATION_LOOKBACK_DAYS });
            if (result.insertedCount > 0) clearLocalActivityCaches();
            if (result.errorCount === 0) updateCloudBacklog({ importPending: false });
          } catch (error) {
            // Import is optional reconstruction. Continue with activity the
            // tracker already has instead of treating it as a Cloud failure.
            // The dashboard can retry its one-shot import when this attempt failed.
            if (!cancelled && selectedProviderUnchanged()) onBrowserHistoryImportFailed();
            console.warn("First-day browser history import unavailable", error);
          } finally {
            importFinishedAt = Date.now();
          }
        }
        // Complete + reveal yesterday when it has data (otherwise today, then the day before), and
        // open the dashboard there.
        today = await resolveFirstDayTargetDay(today, startOfDayMinutes);
        updateCloudBacklog({ day: today });
        // Once the cap has revealed the dashboard, preserve any day the user
        // selected while the import was still finishing.
        if (!settled) {
          // The screen narrates this day only once its activity has loaded. The automatic selection
          // holds until the date actually rolls over, so the dashboard opens on the prepared day.
          setPreparedDay?.(today);
          selectDay(today, { userSelected: false });
          await refresh(today, { foreground: true });
        }

        if (aiCouldBecomeAvailable && !settled) {
          let classifyOptions = localAiClassificationOptionsRef.current;
          if (!classifyOptions && !canUseCloudAiClassificationRef.current && managedLocalSelected) {
            markPhase("downloading");
            setProgress(null);
            classifyOptions = await waitForManagedModelOptions();
            if (!classifyOptions && !settled) {
              fail("classification_incomplete", "The selected local model did not become ready.");
              return;
            }
          }
          if (!classifyOptions && cloudAiSelected && !canUseCloudAiClassificationRef.current && !settled) {
            markPhase("classifying");
            setProgress(null);
            const cloudReady = await waitForCloudAiAvailability();
            if (!cloudReady && !settled) {
              if (!selectedProviderUnchanged()) {
                fail("classification_incomplete", "The selected AI provider changed during preparation.");
              } else {
                // The readiness flag cannot distinguish a slow account refresh
                // from a lasting Cloud denial. Let the dashboard open and keep
                // watching for readiness instead of declaring preparation failed.
                revealPartialCloudDay("cloud_not_ready");
              }
              return;
            }
          }

          if (classifyOptions?.localProvider.provider === "managed_local" && !settled) {
            markPhase("downloading");
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
            markPhase("classifying");
            setProgress(null);
            const complete = await classifyTodayWithProgress(today, classifyOptions);
            if (complete) await completeCloudBacklogIfEmpty(today, "foreground");
            if (!complete && !settled) {
              // Only quota pacing may bypass the retry choice. A confirmed
              // non-quota failure remains visible as the product decision requires.
              if (cloudAiSelected && lastForegroundFailure === "quota") revealPartialCloudDay("classification_incomplete");
              else fail("classification_incomplete");
              return;
            }
            // The closing reload covers anything a pending background reload would have shown.
            stopLiveRefresh();
            if (!settled) await refresh(today);
          } else if (!settled) {
            fail("classification_incomplete", "The selected AI route is unavailable.");
            return;
          }
        }
      } catch (error) {
        fail("classification_incomplete", error);
      } finally {
        clearTimeout(safetyTimeout);
        stopLiveRefresh();
        if (!settled) reveal();
        if (!revealed && cloudBacklog) releaseFirstDayCloudBacklog(cloudBacklog.runId);

        // Background: classify the rest of the import window without blocking the reveal.
        // A managed model that outlived the gate's backstop is awaited here, so the
        // revealed (heuristic) dashboard still fills in with AI classifications.
        if (revealed && aiCouldBecomeAvailable && !shouldBlockLocalTrackerAccess) {
          void (async () => {
            try {
            if (!selectedProviderUnchanged()) return;
            let backgroundOptions = localAiClassificationOptionsRef.current;
            if (!backgroundOptions && !canUseCloudAiClassificationRef.current && managedLocalSelected) {
              backgroundOptions = await waitForManagedModelInBackground();
              if (!backgroundOptions) return;
            }
            if (!backgroundOptions && (!cloudAiSelected || !(await waitForCloudInBackground()))) return;
            const offsets = partialCloudReveal ? [0, ...FIRST_DAY_PREPARATION_BACKGROUND_DAY_OFFSETS] : FIRST_DAY_PREPARATION_BACKGROUND_DAY_OFFSETS;
            for (const offset of offsets) {
              if (cancelled || !selectedProviderUnchanged()) return;
              const day = shiftIsoDate(today, offset);
              if (day < oldestImportedWholeDay) continue;
              try {
                if (offset === 0 && foregroundBatchRef.current?.day === day) {
                  await foregroundBatchRef.current.promise.catch(() => undefined);
                }
                // Keep the existing one-pass behavior for older imported days.
                // Quota-aware retries are reserved for the selected first day.
                if (offset !== 0) {
                  while (!cancelled && selectedProviderUnchanged() && getClassificationActivitySnapshot().running) {
                    await firstDayPreparationDelay(1_000);
                  }
                  if (cancelled || !selectedProviderUnchanged()) return;
                  const summary = await runClassificationForDay(day, backgroundOptions);
                  if (summary.savedRecords > 0 && selectedDayRef.current === day) await refresh(day);
                  continue;
                }
                let consecutiveBackgroundFailures = 0;
                for (let attempt = 0; attempt < FIRST_DAY_PREPARATION_MAX_CLASSIFY_BATCHES; attempt += 1) {
                  if (cancelled || !selectedProviderUnchanged()) return;
                  if (!(await waitForCloudInBackground())) return;
                  while (!cancelled && selectedProviderUnchanged() && getClassificationActivitySnapshot().running) {
                    await firstDayPreparationDelay(1_000);
                  }
                  if (cancelled || !selectedProviderUnchanged()) return;
                  let summary: AiClassificationSummary;
                  try {
                    summary = await runClassificationForDay(day, backgroundOptions);
                  } catch (error) {
                    const failure = await describeAiClassificationFailure(error);
                    if (failure.failureKind === "quota") {
                      await firstDayPreparationDelay(cloudQuotaRetryDelay(failure.quotaWindow));
                      continue;
                    }
                    if (failure.failureKind === "content") break;
                    consecutiveBackgroundFailures += 1;
                    await firstDayPreparationDelay(cloudBackgroundRetryDelay(consecutiveBackgroundFailures));
                    continue;
                  }
                  if (summary.savedRecords > 0 && selectedDayRef.current === day) await refresh(day);
                  if (summary.status === "empty") {
                    await completeCloudBacklogIfEmpty(day, "background");
                    break;
                  }
                  if (summary.failureKind === "quota") {
                    await firstDayPreparationDelay(cloudQuotaRetryDelay(summary.quotaWindow));
                    continue;
                  }
                  if (summary.failureKind === "content") break;
                  if (summary.status === "error" || summary.status === "disabled" || summary.savedRecords === 0) {
                    consecutiveBackgroundFailures += 1;
                    await firstDayPreparationDelay(cloudBackgroundRetryDelay(consecutiveBackgroundFailures));
                    continue;
                  }
                  consecutiveBackgroundFailures = 0;
                  let remaining;
                  try {
                    remaining = await trackerClient.getUnclassifiedSegments({ ...toClassificationQueryForDay(day), limit: 1 });
                  } catch {
                    consecutiveBackgroundFailures += 1;
                    await firstDayPreparationDelay(cloudBackgroundRetryDelay(consecutiveBackgroundFailures));
                    continue;
                  }
                  if (remaining.length === 0) {
                    await completeCloudBacklogIfEmpty(day, "background");
                    break;
                  }
                }
              } catch {
                // best-effort background classification
              }
            }
            } finally {
              if (cloudBacklog) releaseFirstDayCloudBacklog(cloudBacklog.runId);
            }
          })();
        } else if (cloudBacklog) {
          releaseFirstDayCloudBacklog(cloudBacklog.runId);
        }
      }
    })();

    return () => {
      if (!revealed) cancelled = true;
      if (!revealed && cloudBacklog) releaseFirstDayCloudBacklog(cloudBacklog.runId);
      clearTimeout(safetyTimeout);
      stopLiveRefresh();
    };
    // Retrying is the only dependency besides the gate itself that starts a new
    // attempt; live readiness is read through refs to avoid cancelling mid-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparingFirstDay, retryRevision]);

  return { continueAnyway, failure, rearm, retry };
}
