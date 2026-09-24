// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiClassificationRunOptions, AiClassificationSummary } from "../classification/aiClassificationService";
import type { LocalAiClassificationOptions } from "../settings/localAiClassificationOptions";
import { readFirstDayCloudBacklog } from "./firstDayCloudBacklog";
import {
  FIRST_DAY_PREPARATION_CLOUD_READY_WAIT_MS,
  FIRST_DAY_PREPARATION_CLOUD_MAX_MS,
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
    onBrowserHistoryImportFailed: vi.fn(),
    onReveal: vi.fn(),
    refresh: vi.fn().mockResolvedValue(true),
    selectDay: vi.fn(),
    setPhase: vi.fn(),
    setProgress: vi.fn(),
    runAiClassification: vi.fn().mockResolvedValue(emptySummary),
    runAiClassificationUntilEmpty: vi.fn().mockResolvedValue(emptySummary),
    selectedAiProviderKeyRef: { current: "cloud" },
    ...overrides,
  };
}

function makeLocalOptions(overrides: Partial<UseFirstDayPreparationOptions> = {}): UseFirstDayPreparationOptions {
  return makeOptions({
    cloudAiSelected: false,
    canUseCloudAiClassificationRef: { current: false },
    localAiClassificationOptionsRef: {
      current: { localProvider: { provider: "self_hosted", baseUrl: "http://127.0.0.1:39217/v1", model: "test" } },
    },
    ...overrides,
  });
}

describe("useFirstDayPreparation", () => {
  beforeEach(() => {
    localStorage.clear();
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
    const options = makeLocalOptions({ runAiClassification: runAiClassification as UseFirstDayPreparationOptions["runAiClassification"] });

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
    const options = makeLocalOptions({ runAiClassification: runAiClassification as UseFirstDayPreparationOptions["runAiClassification"] });

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
    const options = makeLocalOptions({ runAiClassification });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(40));

    expect(runAiClassification).toHaveBeenCalledTimes(4);
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("classification_incomplete");
  });

  it("does not accept an empty batch while local candidates remain", async () => {
    trackerMocks.getUnclassifiedSegments.mockResolvedValue([{}]);
    const stillIncompleteEmptySummary = summary({
      status: "empty",
      selectedSegments: 0,
      savedRecords: 0,
      metrics: metrics(20, 17),
    });
    const runAiClassification = vi.fn().mockResolvedValue(stillIncompleteEmptySummary);
    const options = makeLocalOptions({ runAiClassification });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(40));

    expect(runAiClassification).toHaveBeenCalledTimes(4);
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("classification_incomplete");
  });

  it("finishes when only unclassifiable synced-device segments remain in whole-day metrics", async () => {
    const runAiClassification = vi.fn().mockResolvedValue(summary({
      status: "empty",
      metrics: metrics(20, 17),
    }));
    const options = makeOptions({ runAiClassification });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(30);

    expect(trackerMocks.getUnclassifiedSegments).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    expect(options.onReveal).toHaveBeenCalledWith("complete");
    expect(result.current.failure).toBeNull();
  });

  it("reuses a still-running timed-out batch when the user retries", async () => {
    const firstBatch = deferred<AiClassificationSummary>();
    const runAiClassification = vi
      .fn<(...args: unknown[]) => Promise<AiClassificationSummary>>()
      .mockReturnValueOnce(firstBatch.promise)
      .mockResolvedValueOnce(emptySummary);
    const options = makeLocalOptions({ runAiClassification: runAiClassification as UseFirstDayPreparationOptions["runAiClassification"] });

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

  it("does not finish first-day classification with a provider that changed while waiting", async () => {
    const selectedAiProviderKeyRef = { current: "local:model-a" };
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
    const options = makeOptions({
      canUseCloudAiClassificationRef: { current: false },
      cloudAiSelected: false,
      managedLocalSelected: true,
      selectedAiProviderKeyRef,
    });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(20));
    await act(async () => {
      selectedAiProviderKeyRef.current = "local:model-b";
      await vi.advanceTimersByTimeAsync(1_500);
      await flushAsync(20);
    });

    expect(options.runAiClassification).not.toHaveBeenCalled();
    expect(options.runAiClassificationUntilEmpty).not.toHaveBeenCalled();
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("classification_incomplete");
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

  it("does not fall back to Cloud when the selected local route is unconfigured", async () => {
    const options = makeOptions({
      browserHistoryImportEnabled: false,
      canUseCloudAiClassificationRef: { current: true },
      cloudAiSelected: false,
      localAiClassificationOptionsRef: { current: null },
      managedLocalSelected: false,
    });

    renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(20));

    expect(options.runAiClassification).not.toHaveBeenCalled();
    expect(options.runAiClassificationUntilEmpty).not.toHaveBeenCalled();
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("continues classification when the optional browser history import throws", async () => {
    trackerMocks.importBrowserHistory.mockRejectedValue(new Error("history unavailable"));
    const options = makeOptions();

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);

    expect(options.runAiClassification).toHaveBeenCalled();
    expect(options.onReveal).toHaveBeenCalledTimes(1);
    expect(options.onBrowserHistoryImportFailed).toHaveBeenCalledTimes(1);
  });

  it("imports browser history once without a duplicate preview scan", async () => {
    trackerMocks.importBrowserHistory.mockResolvedValue({
      ...emptyImportPreview(),
      insertedCount: 7,
      skippedDuplicateCount: 0,
    });
    const options = makeOptions();

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(30);

    expect(trackerMocks.previewBrowserHistoryImport).not.toHaveBeenCalled();
    expect(trackerMocks.importBrowserHistory).toHaveBeenCalledTimes(1);
    expect(options.clearLocalActivityCaches).toHaveBeenCalledTimes(1);
    expect(options.onBrowserHistoryImportFailed).not.toHaveBeenCalled();
    expect(options.onReveal).toHaveBeenCalledWith("complete");
  });

  it("retains the Cloud import marker after a partial browser read error", async () => {
    trackerMocks.importBrowserHistory.mockResolvedValue({
      ...emptyImportPreview(),
      insertedCount: 4,
      skippedDuplicateCount: 0,
      errorCount: 1,
    });
    const options = makeOptions({ cloudBacklogOwnerId: "test-account" });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(40);

    expect(options.onReveal).toHaveBeenCalledWith("complete");
    expect(readFirstDayCloudBacklog("test-account")?.importPending).toBe(true);
  });

  it("identifies a slow browser import as the Cloud timeout phase", async () => {
    const pendingImport = deferred<ReturnType<typeof emptyImportPreview> & { insertedCount: number; skippedDuplicateCount: number }>();
    trackerMocks.importBrowserHistory.mockReturnValue(pendingImport.promise);
    const cloudReadyRef = { current: false };
    const background = vi.fn().mockResolvedValue(emptySummary);
    const options = makeOptions({ canUseCloudAiClassificationRef: cloudReadyRef, runAiClassificationUntilEmpty: background });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_CLOUD_MAX_MS);
    await flushAsync(20);

    expect(options.onReveal).toHaveBeenCalledWith("continue");
    expect(options.runAiClassification).not.toHaveBeenCalled();
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_preparation", expect.objectContaining({
      provider_kind: "cloud", outcome: "preparation_timed_out", phase: "importing",
      import_duration_bucket: "30_60s", cloud_request_count_bucket: "none", classification_batch_count_bucket: "none",
    }));
    pendingImport.resolve({ ...emptyImportPreview(), insertedCount: 0, skippedDuplicateCount: 0 });
    await flushAsync(30);
    expect(options.selectDay).not.toHaveBeenCalled();
    expect(background).not.toHaveBeenCalled();
    cloudReadyRef.current = true;
    await vi.advanceTimersByTimeAsync(500);
    await flushAsync(30);
    expect(background).toHaveBeenCalled();
  });

  it("keeps interrupted Cloud work across the reveal and clears it after background completion", async () => {
    const pendingImport = deferred<ReturnType<typeof emptyImportPreview> & { insertedCount: number; skippedDuplicateCount: number }>();
    trackerMocks.importBrowserHistory.mockReturnValue(pendingImport.promise);
    const cloudReadyRef = { current: false };
    const options = makeOptions({
      cloudBacklogOwnerId: "test-account",
      canUseCloudAiClassificationRef: cloudReadyRef,
    });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    expect(readFirstDayCloudBacklog("test-account")?.importPending).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_CLOUD_MAX_MS);
    expect(options.onReveal).toHaveBeenCalledWith("continue");
    expect(readFirstDayCloudBacklog("test-account")?.importPending).toBe(true);

    pendingImport.resolve({ ...emptyImportPreview(), insertedCount: 4, skippedDuplicateCount: 0 });
    await flushAsync(40);
    expect(readFirstDayCloudBacklog("test-account")?.importPending).toBe(false);
    cloudReadyRef.current = true;
    await vi.advanceTimersByTimeAsync(500);
    await flushAsync(40);
    expect(readFirstDayCloudBacklog("test-account")).toBeNull();
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_backlog", { source: "background" });
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

  it("opens the dashboard after a Cloud readiness wait and resumes when Cloud becomes ready", async () => {
    const cloudReadyRef = { current: false };
    const options = makeOptions({ canUseCloudAiClassificationRef: cloudReadyRef });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_CLOUD_READY_WAIT_MS);
      await flushAsync(20);
    });

    expect(options.runAiClassification).not.toHaveBeenCalled();
    expect(options.onReveal).toHaveBeenCalledWith("continue");
    expect(result.current.failure).toBeNull();
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_preparation", expect.objectContaining({
      provider_kind: "cloud", outcome: "cloud_not_ready", phase: "classifying",
    }));

    cloudReadyRef.current = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsync(20);
    });
    expect(options.runAiClassificationUntilEmpty).toHaveBeenCalled();
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

  it("reveals a partial Cloud day on minute quota and retries the target day in the background", async () => {
    const quota = new Error("Minute AI classification quota exceeded. Please wait before trying again.");
    const runAiClassification = vi.fn().mockRejectedValueOnce(quota);
    const background = vi.fn().mockRejectedValueOnce(quota).mockResolvedValue(emptySummary);
    const options = makeOptions({ runAiClassification, runAiClassificationUntilEmpty: background });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(40);

    expect(runAiClassification).toHaveBeenCalledTimes(1);
    expect(options.onReveal).toHaveBeenCalledWith("continue");
    expect(result.current.failure).toBeNull();
    expect(background).toHaveBeenCalledTimes(1);
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_preparation", expect.objectContaining({
      outcome: "classification_incomplete",
      phase: "classifying",
      quota_window: "minute",
      quota_wait_count_bucket: "1",
      duration_bucket: "under_30s",
    }));

    await vi.advanceTimersByTimeAsync(59_999);
    await flushAsync(20);
    expect(background).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushAsync(30);
    expect(background).toHaveBeenCalledTimes(4); // initial quota, target-day retry, then two older days
  });

  it("opens a 120-segment Cloud day after several batches hit quota and resumes the remainder", async () => {
    let classified = 0;
    trackerMocks.getClassificationMetrics.mockImplementation(async () => metrics(120, classified));
    const runAiClassification = vi.fn(async () => {
      if (classified >= 40) throw new Error("Minute AI classification quota exceeded. Please wait before trying again.");
      classified += 10;
      return summary({ selectedSegments: 10, savedRecords: 10, metrics: metrics(120, classified) });
    });
    const background = vi.fn().mockResolvedValue(summary({ status: "empty", metrics: metrics(120, 120) }));
    const options = makeOptions({ runAiClassification, runAiClassificationUntilEmpty: background });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(80);

    expect(runAiClassification).toHaveBeenCalledTimes(5);
    expect(runAiClassification).toHaveBeenNthCalledWith(5, expect.anything(), 10, expect.objectContaining({ level: "normal" }));
    expect(options.onReveal).toHaveBeenCalledWith("continue");
    expect(background).toHaveBeenCalled();
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_preparation", expect.objectContaining({
      quota_window: "minute",
      initial_segment_count_bucket: "100_plus",
      remaining_segment_count_bucket: "51_100",
    }));
  });

  it.each([
    { window: "hour", message: "Hourly AI classification quota exceeded. Please try again later.", waitMs: 60 * 60 * 1000 },
    { window: "day", message: "Daily AI classification quota exceeded. Please try again tomorrow.", waitMs: 90 * 1000 },
  ])("waits for the $window Cloud quota window before retrying the selected day", async ({ message, waitMs }) => {
    vi.setSystemTime(new Date("2026-09-24T23:59:30.000Z"));
    const quota = new Error(message);
    const background = vi.fn().mockRejectedValueOnce(quota).mockResolvedValue(emptySummary);
    const options = makeOptions({
      runAiClassification: vi.fn().mockRejectedValueOnce(quota),
      runAiClassificationUntilEmpty: background,
    });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(40);
    expect(options.onReveal).toHaveBeenCalledWith("continue");
    expect(background).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(waitMs - 1);
    expect(background).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushAsync(30);
    expect(background).toHaveBeenCalledTimes(4); // quota, target-day retry, then two older days
  });

  it("retries transient Cloud background failures until the imported day is classified", async () => {
    const quota = new Error("Minute AI classification quota exceeded. Please wait before trying again.");
    const transientResult = summary({ status: "error", failureKind: "transport", savedRecords: 0 });
    const background = vi.fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce(transientResult)
      .mockResolvedValue(emptySummary);
    const options = makeOptions({
      runAiClassification: vi.fn().mockRejectedValueOnce(quota),
      runAiClassificationUntilEmpty: background,
    });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(40);
    expect(options.onReveal).toHaveBeenCalledWith("continue");
    expect(result.current.failure).toBeNull();
    expect(background).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_RETRY_BASE_MS);
    await flushAsync(30);
    expect(background).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_RETRY_BASE_MS * 2);
    await flushAsync(30);
    expect(background).toHaveBeenCalledTimes(5); // target-day recovery, then two older days
  });

  it("stops the previous Cloud backlog when onboarding is rearmed", async () => {
    const quota = new Error("Minute AI classification quota exceeded. Please wait before trying again.");
    const background = vi.fn().mockRejectedValueOnce(quota).mockResolvedValue(emptySummary);
    const options = makeOptions({
      runAiClassification: vi.fn().mockRejectedValueOnce(quota),
      runAiClassificationUntilEmpty: background,
    });
    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(40);
    expect(background).toHaveBeenCalledTimes(1);

    act(() => result.current.rearm());
    await vi.advanceTimersByTimeAsync(60_000);
    await flushAsync(20);
    expect(background).toHaveBeenCalledTimes(1);
  });

  it("does not retry a quota after the preparation effect is unmounted before reveal", async () => {
    const pending = deferred<AiClassificationSummary>();
    const options = makeOptions({ runAiClassification: vi.fn().mockReturnValue(pending.promise) });
    const { unmount } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    unmount();
    pending.reject(new Error("Minute AI classification quota exceeded. Please wait before trying again."));
    await vi.advanceTimersByTimeAsync(60_000);
    await flushAsync(20);
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(options.runAiClassificationUntilEmpty).not.toHaveBeenCalled();
  });

  it("classifies an imported Cloud backlog after a slow import opens the dashboard", async () => {
    const pendingImport = deferred<ReturnType<typeof emptyImportPreview> & { insertedCount: number; skippedDuplicateCount: number }>();
    trackerMocks.importBrowserHistory.mockReturnValue(pendingImport.promise);
    trackerMocks.getClassificationMetrics.mockResolvedValue(metrics(120, 0));
    const background = vi.fn().mockResolvedValue(emptySummary);
    const options = makeOptions({ runAiClassificationUntilEmpty: background });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_CLOUD_MAX_MS);
    expect(options.onReveal).toHaveBeenCalledWith("continue");

    pendingImport.resolve({ ...emptyImportPreview(), insertedCount: 120, skippedDuplicateCount: 0 });
    await flushAsync(50);
    expect(options.clearLocalActivityCaches).toHaveBeenCalledTimes(1);
    expect(background).toHaveBeenCalled();
  });

  it("reveals on hourly Cloud quota without retrying in the foreground", async () => {
    const runAiClassification = vi.fn().mockRejectedValue(new Error("Hourly AI classification quota exceeded. Please try again later."));
    const options = makeOptions({ runAiClassification });
    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(40);

    expect(runAiClassification).toHaveBeenCalledTimes(1);
    expect(options.onReveal).toHaveBeenCalledWith("continue");
    expect(result.current.failure).toBeNull();
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_preparation", expect.objectContaining({
      outcome: "classification_incomplete", presentation: "dashboard_partial", phase: "classifying", quota_window: "hour", failure_kind: "quota", error_kind: "rate_limited",
    }));
  });

  it("opens the dashboard at the Cloud time cap without starting a duplicate in-flight batch", async () => {
    const pending = deferred<AiClassificationSummary>();
    const runAiClassification = vi.fn().mockReturnValueOnce(pending.promise);
    const background = vi.fn().mockResolvedValue(emptySummary);
    const options = makeOptions({ runAiClassification, runAiClassificationUntilEmpty: background });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    const timing = (vi.mocked(options.runAiClassification).mock.calls[0]?.[2] as AiClassificationRunOptions | undefined)?.onCloudRequestTiming;
    expect(timing).toBeTypeOf("function");
    timing?.("started", 0);
    await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_CLOUD_MAX_MS);
    await flushAsync(20);

    expect(options.onReveal).toHaveBeenCalledWith("continue");
    expect(result.current.failure).toBeNull();
    expect(runAiClassification).toHaveBeenCalledTimes(1);
    expect(background).not.toHaveBeenCalled();
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_preparation", expect.objectContaining({
      provider_kind: "cloud", outcome: "preparation_timed_out", presentation: "dashboard_partial", phase: "classifying",
      import_duration_bucket: "under_5s", time_to_first_cloud_request_bucket: "under_5s",
      cloud_request_duration_bucket: "30_60s", cloud_request_count_bucket: "1", classification_batch_count_bucket: "1",
    }));

    // A production-sized Cloud request may finish after the 45-second reveal.
    // The background pass must wait for that same request, then finish the day.
    await vi.advanceTimersByTimeAsync(9_000);
    expect(runAiClassification).toHaveBeenCalledTimes(1);
    expect(background).not.toHaveBeenCalled();
    timing?.("settled", 54_000);
    pending.resolve(savedSummary);
    await flushAsync(30);
    expect(background).toHaveBeenCalled();
  });

  it("retries the selected day after a Cloud request times out past the dashboard reveal", async () => {
    const pending = deferred<AiClassificationSummary>();
    const background = vi.fn().mockResolvedValue(emptySummary);
    const options = makeOptions({
      cloudBacklogOwnerId: "test-account",
      runAiClassification: vi.fn().mockReturnValue(pending.promise),
      runAiClassificationUntilEmpty: background,
    });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_CLOUD_MAX_MS);
    expect(options.onReveal).toHaveBeenCalledWith("continue");
    expect(background).not.toHaveBeenCalled();

    pending.reject(new Error("The Cloud classification request timed out."));
    await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_RETRY_BASE_MS);
    await flushAsync(40);
    expect(background).toHaveBeenCalled();
    expect(readFirstDayCloudBacklog("test-account")).toBeNull();
  });

  it("keeps a confirmed Cloud transport failure on the retry screen", async () => {
    const runAiClassification = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const background = vi.fn().mockResolvedValue(emptySummary);
    const options = makeOptions({ runAiClassification, runAiClassificationUntilEmpty: background });

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
    expect(background).not.toHaveBeenCalled();
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_preparation", expect.objectContaining({
      provider_kind: "cloud", outcome: "classification_incomplete", presentation: "retry_screen", phase: "classifying", failure_kind: "transient", error_kind: "network",
    }));
  });

  it("identifies a structured Cloud parse failure on the retry screen", async () => {
    const cloudError = {
      context: Response.json({ error: "OpenRouter response was not parseable JSON", errorType: "parse" }, { status: 502 }),
    };
    const options = makeOptions({ runAiClassification: vi.fn().mockRejectedValue(cloudError) });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);
    await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_RETRY_BASE_MS);
    await flushAsync(20);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_DAY_PREPARATION_RETRY_BASE_MS * 2);
      await flushAsync(40);
    });

    expect(result.current.failure).toBe("classification_incomplete");
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_preparation", expect.objectContaining({
      outcome: "classification_incomplete", presentation: "retry_screen", cloud_error_type: "parse",
    }));
  });

  it("keeps a local content-level classification miss on the retry screen", async () => {
    const contentMiss = summary({
      status: "error",
      selectedSegments: 3,
      savedRecords: 0,
      failureKind: "content",
      message: "AI classification returned no usable classifications.",
    });
    const runAiClassification = vi.fn().mockResolvedValue(contentMiss);
    const options = makeLocalOptions({ runAiClassification });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(40));

    expect(runAiClassification).toHaveBeenCalledTimes(4);
    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("classification_incomplete");
  });

  it("keeps a Cloud content-level miss on the retry screen instead of silently hiding it", async () => {
    const contentMiss = summary({
      status: "error",
      selectedSegments: 3,
      savedRecords: 0,
      failureKind: "content",
    });
    const options = makeOptions({ runAiClassification: vi.fn().mockResolvedValue(contentMiss) });

    const { result } = renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(40));

    expect(options.onReveal).not.toHaveBeenCalled();
    expect(result.current.failure).toBe("classification_incomplete");
    expect(analyticsMocks.capturePostHogEvent).toHaveBeenCalledWith("first_day_preparation", expect.objectContaining({
      provider_kind: "cloud", outcome: "classification_incomplete", presentation: "retry_screen", phase: "classifying", failure_kind: "content",
    }));
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
    const contentMiss = summary({ status: "error", selectedSegments: 3, savedRecords: 0, failureKind: "content" });
    const runAiClassification = vi.fn()
      .mockResolvedValueOnce(contentMiss)
      .mockResolvedValueOnce(contentMiss)
      .mockResolvedValueOnce(contentMiss)
      .mockResolvedValueOnce(contentMiss)
      .mockResolvedValue(emptySummary);
    const options = makeLocalOptions({ runAiClassification });
    const { result } = renderHook(() => useFirstDayPreparation(options));
    await act(async () => flushAsync(50));
    expect(result.current.failure).toBe("classification_incomplete");

    await act(async () => {
      result.current.retry();
      await flushAsync(30);
    });
    expect(options.onReveal).toHaveBeenCalledTimes(1);
    // A finished run has earned its closing beat.
    expect(options.onReveal).toHaveBeenCalledWith("complete");

    const secondOptions = makeLocalOptions({ runAiClassification: vi.fn().mockResolvedValue(contentMiss) });
    const second = renderHook(() => useFirstDayPreparation(secondOptions));
    await act(async () => flushAsync(50));
    expect(second.result.current.failure).toBe("classification_incomplete");
    act(() => second.result.current.continueAnyway());
    expect(secondOptions.onReveal).toHaveBeenCalledTimes(1);
    // Moving on from a paused run has not; it must not be dressed up as success.
    expect(secondOptions.onReveal).toHaveBeenCalledWith("continue");
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
