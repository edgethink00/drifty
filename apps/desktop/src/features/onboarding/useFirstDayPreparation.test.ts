// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiClassificationSummary } from "../classification/aiClassificationService";
import type { LocalAiClassificationOptions } from "../settings/localAiClassificationOptions";
import { evaluateAiClassificationAccess } from "../../../supabase/functions/classify-activity/quota";
import {
  FIRST_DAY_PREPARATION_CLOUD_READY_WAIT_MS,
  FIRST_DAY_PREPARATION_MAX_MS,
  FIRST_DAY_PREPARATION_RETRY_BASE_MS,
  FIRST_DAY_PREPARATION_TRANSIENT_FAILURE_LIMIT,
  resolveFirstDayTargetDay,
  useFirstDayPreparation,
  type UseFirstDayPreparationOptions,
} from "./useFirstDayPreparation";

const trackerMocks = vi.hoisted(() => ({
  getClassificationMetrics: vi.fn(),
  importBrowserHistory: vi.fn(),
  previewBrowserHistoryImport: vi.fn(),
  getTimeline: vi.fn(),
  getUnclassifiedSegments: vi.fn(),
}));

const analyticsMocks = vi.hoisted(() => ({
  capturePostHogEvent: vi.fn(),
}));

vi.mock("../../lib/analytics/posthogClient", () => ({
  capturePostHogEvent: analyticsMocks.capturePostHogEvent,
}));

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: trackerMocks,
}));

const managedAiMocks = vi.hoisted(() => ({
  getManagedLocalAiStatus: vi.fn(),
  startManagedLocalAi: vi.fn(),
}));

vi.mock("../settings/managedLocalAiClient", () => ({
  getManagedLocalAiStatus: managedAiMocks.getManagedLocalAiStatus,
  startManagedLocalAi: managedAiMocks.startManagedLocalAi,
}));

const CLASSIFY_STALL_MS = 75 * 1000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function summary(partial: Partial<AiClassificationSummary>): AiClassificationSummary {
  return { status: "saved", selectedSegments: 0, savedRecords: 0, message: "", ...partial };
}

function metrics(totalSegments: number, classifiedSegments = 0) {
  return {
    totalSegments,
    classifiedSegments,
    unclassifiedSegments: totalSegments - classifiedSegments,
    aiClassifiedSegments: classifiedSegments,
    staleClassifications: 0,
  };
}

const emptySummary = summary({
  status: "empty",
  selectedSegments: 0,
  savedRecords: 0,
  metrics: metrics(20, 20),
});
const savedSummary = summary({ status: "saved", selectedSegments: 5, savedRecords: 5 });

function emptyImportPreview() {
  return {
    lookbackDays: 2,
    candidateCount: 0,
    segmentCount: 0,
    estimatedSeconds: 0,
    browserCount: 0,
    profileCount: 0,
    databaseCount: 0,
    errorCount: 0,
    windowStart: "2026-07-02T00:00:00.000Z",
    windowEnd: "2026-07-04T00:00:00.000Z",
  };
}

// Drains the microtask queue so the gate's async run advances between timer steps.
async function flushAsync(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function makeOptions(overrides: Partial<UseFirstDayPreparationOptions> = {}): UseFirstDayPreparationOptions {
  return {
    preparingFirstDay: true,
    browserHistoryImportEnabled: true,
    canUseCloudAiClassificationRef: { current: true },
    cloudAiSelected: true,
    localAiClassificationOptionsRef: { current: null },
    managedLocalSelected: false,
    shouldBlockLocalTrackerAccess: false,
    startOfDayMinutes: 0,
    selectedDayRef: { current: "2026-07-04" },
    clearLocalActivityCaches: vi.fn(),
    onReveal: vi.fn(),
    refresh: vi.fn().mockResolvedValue(true),
    selectDay: vi.fn(),
    setPhase: vi.fn(),
    setProgress: vi.fn(),
    runAiClassification: vi.fn().mockResolvedValue(emptySummary),
    runAiClassificationUntilEmpty: vi.fn().mockResolvedValue(emptySummary),
    ...overrides,
  };
}

describe("useFirstDayPreparation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    analyticsMocks.capturePostHogEvent.mockReset();
    managedAiMocks.getManagedLocalAiStatus.mockReset().mockResolvedValue({
      state: "not_installed",
      selectedModelId: null,
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "",
      artifactDir: null,
      progress: null,
      errorKind: null,
      memoryUsageBytes: null,
    });
    managedAiMocks.startManagedLocalAi.mockReset().mockResolvedValue({
      state: "running",
      selectedModelId: "drifty-qwen3-5-4b-default",
      installedModels: ["drifty-qwen3-5-4b-default"],
      baseUrl: "http://127.0.0.1:39217/v1",
      model: "qwen",
      message: "Ready",
      artifactDir: null,
      progress: null,
      errorKind: null,
      memoryUsageBytes: null,
    });
    trackerMocks.getClassificationMetrics.mockReset().mockResolvedValue(metrics(20, 0));
    trackerMocks.previewBrowserHistoryImport.mockReset().mockResolvedValue(emptyImportPreview());
    trackerMocks.importBrowserHistory.mockReset().mockResolvedValue({
      ...emptyImportPreview(),
      insertedCount: 0,
      skippedDuplicateCount: 0,
    });
    // Timeline reads are not part of the whole-day completion contract.
    trackerMocks.getTimeline.mockReset().mockResolvedValue([]);
    trackerMocks.getUnclassifiedSegments.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not treat a batch timeout as completion; a later real empty result ends classification", async () => {
    const firstBatch = deferred<AiClassificationSummary>();
    const runAiClassification = vi
      .fn<(...args: unknown[]) => Promise<AiClassificationSummary>>()
      .mockReturnValueOnce(firstBatch.promise)
      .mockResolvedValueOnce(emptySummary);
    const options = makeOptions({ runAiClassification: runAiClassification as UseFirstDayPreparationOptions["runAiClassification"] });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(1);

    // First batch outlives its stall window. If the fabricated timeout summary were
    // misread as "nothing left", the gate would reveal right here (regression check).
    await vi.advanceTimersByTimeAsync(CLASSIFY_STALL_MS);
    await flushAsync(20);
    expect(options.onReveal).not.toHaveBeenCalled();

    // The pending batch finally settles with real progress; the next batch then
    // returns a genuinely empty result and classification ends.
    firstBatch.resolve(savedSummary);
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(2);
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("keeps classification batches single-flight while a slow batch is pending", async () => {
    const firstBatch = deferred<AiClassificationSummary>();
    const runAiClassification = vi
      .fn<(...args: unknown[]) => Promise<AiClassificationSummary>>()
      .mockReturnValueOnce(firstBatch.promise)
      .mockResolvedValueOnce(emptySummary);
    const options = makeOptions({ runAiClassification: runAiClassification as UseFirstDayPreparationOptions["runAiClassification"] });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(1);

    // Two consecutive stall windows elapse while the first call is still pending:
    // no second call may be launched on top of it.
    await vi.advanceTimersByTimeAsync(CLASSIFY_STALL_MS);
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CLASSIFY_STALL_MS);
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(1);

    // Only once the pending promise settles does the next batch fire.
    firstBatch.resolve(savedSummary);
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(2);
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("pauses after four consecutive no-progress batches instead of revealing Unclassified", async () => {
    const noProgressSummary = summary({ status: "saved", selectedSegments: 3, savedRecords: 0 });
    const runAiClassification = vi.fn().mockResolvedValue(noProgressSummary);
    const options = makeOptions({ runAiClassification });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(40));

    expect(runAiClassification).toHaveBeenCalledTimes(4);
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("classification_incomplete");
  });

  it("does not accept an empty batch while whole-day metrics still report Unclassified", async () => {
    const stillIncompleteEmptySummary = summary({
      status: "empty",
      selectedSegments: 0,
      savedRecords: 0,
      metrics: metrics(20, 17),
    });
    const runAiClassification = vi.fn().mockResolvedValue(stillIncompleteEmptySummary);
    const options = makeOptions({ runAiClassification });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(40));

    expect(runAiClassification).toHaveBeenCalledTimes(4);
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("classification_incomplete");
  });

  it("reuses a still-running timed-out batch when the user retries", async () => {
    const firstBatch = deferred<AiClassificationSummary>();
    const runAiClassification = vi
      .fn<(...args: unknown[]) => Promise<AiClassificationSummary>>()
      .mockReturnValueOnce(firstBatch.promise)
      .mockResolvedValueOnce(emptySummary);
    const options = makeOptions({ runAiClassification: runAiClassification as UseFirstDayPreparationOptions["runAiClassification"] });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(1);

    // Three consecutive stall windows on the same pending batch trip the
    // transient-failure limit without launching a second in-flight call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLASSIFY_STALL_MS * FIRST_DAY_PREPARATION_TRANSIENT_FAILURE_LIMIT);
      await flushAsync(30);
    });
    expect(result.current.failure).toBe("classification_incomplete");
    expect(runAiClassification).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.retry();
      await flushAsync(30);
    });
    expect(runAiClassification).toHaveBeenCalledTimes(1);
    expect(options.onReveal).not.toHaveBeenCalled();

    await act(async () => {
      firstBatch.resolve(savedSummary);
      await flushAsync(40);
    });
    expect(runAiClassification).toHaveBeenCalledTimes(2);
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("classifies the whole target day instead of limiting batches to visible flow blocks", async () => {
    trackerMocks.getClassificationMetrics.mockResolvedValue(metrics(20, 3));
    const runAiClassification = vi
      .fn<(...args: unknown[]) => Promise<AiClassificationSummary>>()
      .mockResolvedValueOnce(savedSummary)
      .mockResolvedValueOnce(emptySummary);
    const options = makeOptions({ runAiClassification: runAiClassification as UseFirstDayPreparationOptions["runAiClassification"] });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(30);

    const firstQuery = runAiClassification.mock.calls[0]?.[0] as { segmentIds?: string[] } | undefined;
    expect(firstQuery?.segmentIds).toBeUndefined();
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("waits for a managed model download before classifying, then uses the attached options", async () => {
    const optionsRef = { current: null as LocalAiClassificationOptions | null };
    managedAiMocks.getManagedLocalAiStatus.mockResolvedValue({
      state: "installing",
      selectedModelId: "drifty-qwen3-5-4b-default",
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Downloading…",
      artifactDir: null,
      progress: { percent: 44, downloadedBytes: 1_200, totalBytes: 2_700 },
      errorKind: null,
      memoryUsageBytes: null,
    });
    const runAiClassification = vi.fn().mockResolvedValue(emptySummary);
    const options = makeOptions({
      canUseCloudAiClassificationRef: { current: false },
      cloudAiSelected: false,
      managedLocalSelected: true,
      localAiClassificationOptionsRef: optionsRef,
      runAiClassification,
    });

    renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(20));

    // Download still running: the gate sits in the downloading phase, showing
    // real download progress, without classifying or revealing.
    expect(options.setPhase).toHaveBeenCalledWith("downloading");
    expect(options.setProgress).toHaveBeenCalledWith(0.44);
    expect(runAiClassification).not.toHaveBeenCalled();
    expect(options.onReveal).not.toHaveBeenCalled();

    // The model lands: the app-level attach watcher fills the AI setup → ref flips.
    optionsRef.current = {
      localProvider: { provider: "managed_local", baseUrl: "http://127.0.0.1:39217/v1", model: "qwen", modelId: "drifty-qwen3-5-4b-default" },
    };
    await vi.advanceTimersByTimeAsync(1_500);
    await flushAsync(20);

    expect(options.setPhase).toHaveBeenCalledWith("classifying");
    expect(runAiClassification).toHaveBeenCalled();
    expect(runAiClassification.mock.calls[0]?.[2]).toMatchObject({
      level: "normal",
      localProvider: { modelId: "drifty-qwen3-5-4b-default" },
    });
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("pauses when no selected managed model download was ever started", async () => {
    const options = makeOptions({
      canUseCloudAiClassificationRef: { current: false },
      cloudAiSelected: false,
      managedLocalSelected: true,
    });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(20));

    expect(options.setPhase).toHaveBeenCalledWith("downloading");
    expect(options.runAiClassification).not.toHaveBeenCalled();
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("classification_incomplete");
  });

  it("continues classification when the optional browser history import throws", async () => {
    trackerMocks.previewBrowserHistoryImport.mockRejectedValue(new Error("history unavailable"));
    const options = makeOptions();

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);

    expect(options.runAiClassification).toHaveBeenCalled();
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("reveals the dashboard even when analytics capture throws", async () => {
    analyticsMocks.capturePostHogEvent.mockImplementationOnce(() => {
      throw new Error("analytics unavailable");
    });
    const options = makeOptions();

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);

    expect(options.onReveal).toHaveBeenCalledTimes(1);
    expect(result.current.failure).toBeNull();
  });

  it("waits for live Cloud readiness instead of treating the initial false snapshot as final", async () => {
    const cloudReadyRef = { current: false };
    const options = makeOptions({ canUseCloudAiClassificationRef: cloudReadyRef });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);

    expect(options.setPhase).toHaveBeenCalledWith("classifying");
    expect(options.runAiClassification).not.toHaveBeenCalled();
    expect(result.current.failure).toBeNull();

    cloudReadyRef.current = true;
    await vi.advanceTimersByTimeAsync(500);
    await flushAsync(20);

    expect(options.runAiClassification).toHaveBeenCalledTimes(1);
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("pauses with a retry choice when Cloud readiness never settles", async () => {
    const options = makeOptions({ canUseCloudAiClassificationRef: { current: false } });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_CLOUD_READY_WAIT_MS);
      await flushAsync(20);
    });

    expect(options.runAiClassification).not.toHaveBeenCalled();
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("cloud_not_ready");
  });

  it("recovers from a single transient Cloud classification failure", async () => {
    const runAiClassification = vi.fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce(emptySummary);
    const options = makeOptions({ runAiClassification });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(1);
    expect(options.onReveal).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_RETRY_BASE_MS);
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(2);
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("waits out the trial minute quota instead of exhausting all transient retries", async () => {
    vi.setSystemTime(new Date("2026-08-26T00:00:10.000Z"));
    const trialAccess = evaluateAiClassificationAccess(
      { id: "trial-user", email: "trial@example.com" },
      { status: "trialing", canUseApp: true },
    );
    if (trialAccess.kind !== "allowed") throw new Error("Expected the trial quota policy.");
    let classifiedSegments = 0;
    let quotaMinute = -1;
    let callsInQuotaMinute = 0;
    // Preparation issues three passes, so squeeze the burst allowance below that
    // to exercise the wait. Binding to the live policy number instead would make
    // this test silently stop covering the retry path whenever the burst is
    // raised above the pass count.
    const burstAllowanceUnderTest = 2;
    const callTimes: number[] = [];
    const runAiClassification = vi.fn(async (): Promise<AiClassificationSummary> => {
      const now = Date.now();
      const currentQuotaMinute = Math.floor(now / 60_000);
      if (currentQuotaMinute !== quotaMinute) {
        quotaMinute = currentQuotaMinute;
        callsInQuotaMinute = 0;
      }
      callsInQuotaMinute += 1;
      callTimes.push(now);
      if (callsInQuotaMinute > burstAllowanceUnderTest) {
        throw new Error("Minute AI classification quota exceeded. Please wait before trying again.");
      }
      classifiedSegments += 5;
      return summary({
        status: "saved",
        selectedSegments: 5,
        savedRecords: 5,
        metrics: metrics(15, classifiedSegments),
        usedAiProvider: true,
      });
    });
    const options = makeOptions({ runAiClassification });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(30);
    expect(runAiClassification).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(59_999);
    await flushAsync(30);
    expect(runAiClassification).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(101);
    await flushAsync(30);
    expect(runAiClassification).toHaveBeenCalledTimes(4);
    expect(callTimes[3]! - callTimes[2]!).toBeGreaterThanOrEqual(60_000);
    expect(options.onReveal).toHaveBeenCalledTimes(1);
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_preparation", {
      provider_kind: "cloud",
      outcome: "success",
      quota_window: "minute",
      quota_wait_count_bucket: "1",
      duration_bucket: "30_90s",
      initial_segment_count_bucket: "1_20",
      remaining_segment_count_bucket: "none",
    });
  });

  it("waits for the next quota minute when another Cloud path already consumed the available slots", async () => {
    vi.setSystemTime(new Date("2026-08-26T00:00:10.000Z"));
    const runAiClassification = vi.fn()
      .mockRejectedValueOnce(new Error("Minute AI classification quota exceeded. Please wait before trying again."))
      .mockResolvedValueOnce(emptySummary);
    const options = makeOptions({ runAiClassification });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(30);
    expect(runAiClassification).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59_999);
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(101);
    await flushAsync(30);
    expect(runAiClassification).toHaveBeenCalledTimes(2);
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("does not retry a minute quota after the preparation effect is unmounted", async () => {
    const runAiClassification = vi.fn()
      .mockRejectedValue(new Error("Minute AI classification quota exceeded. Please wait before trying again."));
    const options = makeOptions({ runAiClassification });

    const { unmount } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(30);
    expect(runAiClassification).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    await flushAsync(20);

    expect(runAiClassification).toHaveBeenCalledTimes(1);
    expect(options.onReveal).not.toHaveBeenCalled();
  });

  it("keeps minute quota waits outside the generic transient retry budget", async () => {
    const runAiClassification = vi.fn()
      .mockRejectedValueOnce(new Error("Minute AI classification quota exceeded. Please wait before trying again."))
      .mockRejectedValueOnce(new Error("Minute AI classification quota exceeded. Please wait before trying again."))
      .mockResolvedValueOnce(emptySummary);
    const options = makeOptions({ runAiClassification });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(30);
    expect(runAiClassification).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await flushAsync(30);
    expect(runAiClassification).toHaveBeenCalledTimes(2);
    expect(result.current.failure).toBeNull();

    await vi.advanceTimersByTimeAsync(60_000);
    await flushAsync(30);
    expect(runAiClassification).toHaveBeenCalledTimes(3);
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("does not hammer an exhausted hourly Cloud quota", async () => {
    const runAiClassification = vi.fn()
      .mockRejectedValue(new Error("Hourly AI classification quota exceeded. Please try again later."));
    const options = makeOptions({ runAiClassification });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(40));

    expect(runAiClassification).toHaveBeenCalledTimes(1);
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("classification_incomplete");
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_preparation", {
      provider_kind: "cloud",
      outcome: "classification_incomplete",
      quota_window: "hour",
      quota_wait_count_bucket: "none",
      duration_bucket: "under_30s",
      initial_segment_count_bucket: "1_20",
      remaining_segment_count_bucket: "1_20",
    });
  });

  it("requires three consecutive transient failures before pausing", async () => {
    const runAiClassification = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const options = makeOptions({ runAiClassification });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_RETRY_BASE_MS);
    await flushAsync(20);
    expect(runAiClassification).toHaveBeenCalledTimes(2);
    expect(result.current.failure).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_RETRY_BASE_MS * 2);
      await flushAsync(20);
    });
    expect(runAiClassification).toHaveBeenCalledTimes(FIRST_DAY_PREPARATION_TRANSIENT_FAILURE_LIMIT);
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("classification_incomplete");
  });

  it("does not treat a content-level classification miss as a retryable Cloud blip", async () => {
    const contentMiss = summary({
      status: "error",
      selectedSegments: 3,
      savedRecords: 0,
      failureKind: "content",
      message: "AI classification returned no usable classifications.",
    });
    const runAiClassification = vi.fn().mockResolvedValue(contentMiss);
    const options = makeOptions({ runAiClassification });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(40));

    expect(runAiClassification).toHaveBeenCalledTimes(4);
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("classification_incomplete");
  });

  it("resets the no-progress streak after a later batch actually saves", async () => {
    const noProgress = summary({ status: "saved", selectedSegments: 3, savedRecords: 0 });
    const runAiClassification = vi.fn()
      .mockResolvedValueOnce(noProgress)
      .mockResolvedValueOnce(noProgress)
      .mockResolvedValueOnce(noProgress)
      .mockResolvedValueOnce(savedSummary)
      .mockResolvedValueOnce(emptySummary);
    const options = makeOptions({ runAiClassification });

    renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(50));

    expect(runAiClassification).toHaveBeenCalledTimes(5);
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("retries a paused attempt and lets the user explicitly continue anyway", async () => {
    const cloudReadyRef = { current: false };
    const options = makeOptions({ canUseCloudAiClassificationRef: cloudReadyRef });
    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_CLOUD_READY_WAIT_MS);
      await flushAsync(20);
    });
    expect(result.current.failure).toBe("cloud_not_ready");

    cloudReadyRef.current = true;
    await act(async () => {
      result.current.retry();
      await flushAsync(30);
    });
    expect(options.onReveal).toHaveBeenCalledTimes(1);

    const secondOptions = makeOptions({ canUseCloudAiClassificationRef: { current: false } });
    const second = renderHook(() => useFirstDayPreparation(secondOptions));
    await flushAsync(20);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_CLOUD_READY_WAIT_MS);
      await flushAsync(20);
    });
    act(() => second.result.current.continueAnyway());
    expect(secondOptions.onReveal).toHaveBeenCalledTimes(1);
  });

  it("runs once per arm: a second preparingFirstDay=true is ignored until rearm()", async () => {
    const options = makeOptions();
    const { rerender, result } = renderHook(
      ({ preparing }: { preparing: boolean }) => useFirstDayPreparation({ ...options, preparingFirstDay: preparing }),
      { initialProps: { preparing: true } },
    );
    await flushAsync(20);
    expect(options.onReveal).toHaveBeenCalledTimes(1);

    rerender({ preparing: false });
    rerender({ preparing: true });
    await flushAsync(20);
    expect(options.onReveal).toHaveBeenCalledTimes(1);

    rerender({ preparing: false });
    result.current.rearm();
    rerender({ preparing: true });
    await flushAsync(20);
    expect(options.onReveal).toHaveBeenCalledTimes(2);
  });
});

describe("resolveFirstDayTargetDay", () => {
  beforeEach(() => {
    trackerMocks.getClassificationMetrics.mockReset();
  });

  function mockMetricsByDay(totals: Record<string, number>) {
    trackerMocks.getClassificationMetrics.mockImplementation((query: { day?: string }) =>
      Promise.resolve(metrics(totals[query.day ?? ""] ?? 0)),
    );
  }

  it("picks today when today has enough segments", async () => {
    mockMetricsByDay({ "2026-07-04": 15, "2026-07-03": 40 });
    await expect(resolveFirstDayTargetDay("2026-07-04")).resolves.toBe("2026-07-04");
  });

  it("falls back to yesterday when today is nearly empty", async () => {
    mockMetricsByDay({ "2026-07-04": 3, "2026-07-03": 15 });
    await expect(resolveFirstDayTargetDay("2026-07-04")).resolves.toBe("2026-07-03");
  });

  it("falls back to the day before yesterday when needed", async () => {
    mockMetricsByDay({ "2026-07-04": 0, "2026-07-03": 2, "2026-07-02": 30 });
    await expect(resolveFirstDayTargetDay("2026-07-04")).resolves.toBe("2026-07-02");
  });

  it("returns today when no candidate day has enough segments", async () => {
    mockMetricsByDay({ "2026-07-04": 1, "2026-07-03": 1, "2026-07-02": 1 });
    await expect(resolveFirstDayTargetDay("2026-07-04")).resolves.toBe("2026-07-04");
  });

  it("skips candidates whose metrics lookup fails", async () => {
    trackerMocks.getClassificationMetrics.mockImplementation((query: { day?: string }) => {
      if (query.day === "2026-07-04") return Promise.reject(new Error("tracker offline"));
      return Promise.resolve(metrics(query.day === "2026-07-03" ? 20 : 0));
    });
    await expect(resolveFirstDayTargetDay("2026-07-04")).resolves.toBe("2026-07-03");
  });
});
