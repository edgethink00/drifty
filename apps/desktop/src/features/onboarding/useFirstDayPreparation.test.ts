// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiClassificationSummary } from "../classification/aiClassificationService";
import {
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

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: trackerMocks,
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

const emptySummary = summary({ status: "empty", selectedSegments: 0, savedRecords: 0 });
const savedSummary = summary({ status: "saved", selectedSegments: 5, savedRecords: 5 });

function metrics(totalSegments: number, classifiedSegments = 0) {
  return {
    totalSegments,
    classifiedSegments,
    unclassifiedSegments: totalSegments - classifiedSegments,
    aiClassifiedSegments: classifiedSegments,
    staleClassifications: 0,
  };
}

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
    canUseCloudAiClassification: true,
    localAiClassificationOptions: null,
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
    trackerMocks.getClassificationMetrics.mockReset().mockResolvedValue(metrics(20, 0));
    trackerMocks.previewBrowserHistoryImport.mockReset().mockResolvedValue(emptyImportPreview());
    trackerMocks.importBrowserHistory.mockReset().mockResolvedValue({
      ...emptyImportPreview(),
      insertedCount: 0,
      skippedDuplicateCount: 0,
    });
    // Default: no timeline available → empty visible set → the gate falls back to whole-day
    // classification, preserving the behavior the other tests assert.
    trackerMocks.getTimeline.mockReset().mockResolvedValue([]);
    trackerMocks.getUnclassifiedSegments.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
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

  it("ends classification after four consecutive no-progress batches", async () => {
    const noProgressSummary = summary({ status: "saved", selectedSegments: 3, savedRecords: 0 });
    const runAiClassification = vi.fn().mockResolvedValue(noProgressSummary);
    const options = makeOptions({ runAiClassification });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(40);

    expect(runAiClassification).toHaveBeenCalledTimes(4);
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("reveals once the flow chart's visible set is classified, even with other segments unclassified", async () => {
    // Two segments in distinct 3-minute buckets: each is its bucket's sole (winning) candidate,
    // so the visible set is exactly {seg-1, seg-2}.
    const visibleSegments = [
      { id: "seg-1", appName: "AppA", startedAt: "2026-07-04T09:00:00", endedAt: "2026-07-04T09:02:00" },
      { id: "seg-2", appName: "AppB", startedAt: "2026-07-04T10:00:00", endedAt: "2026-07-04T10:02:00" },
    ];
    trackerMocks.getTimeline.mockResolvedValue(visibleSegments);
    // The whole day still has unclassified segments beyond the visible set...
    trackerMocks.getClassificationMetrics.mockResolvedValue(metrics(20, 3));

    // ...but classification of the allow-listed visible set completes (one saved batch, then a
    // genuinely empty batch because nothing in the allow-list remains) → reveal.
    const runAiClassification = vi
      .fn<(...args: unknown[]) => Promise<AiClassificationSummary>>()
      .mockResolvedValueOnce(savedSummary)
      .mockResolvedValueOnce(emptySummary);
    const options = makeOptions({ runAiClassification: runAiClassification as UseFirstDayPreparationOptions["runAiClassification"] });

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(30);

    // The classify batches were scoped to the visible set via the segmentIds allow-list.
    const firstQuery = runAiClassification.mock.calls[0]?.[0] as { segmentIds?: string[] } | undefined;
    expect(firstQuery?.segmentIds).toEqual(["seg-1", "seg-2"]);
    expect(options.onReveal).toHaveBeenCalledTimes(1);
  });

  it("reveals even when the browser history import throws", async () => {
    trackerMocks.previewBrowserHistoryImport.mockRejectedValue(new Error("history unavailable"));
    const options = makeOptions();

    renderHook(() => useFirstDayPreparation(options));
    await flushAsync(20);

    expect(options.runAiClassification).not.toHaveBeenCalled();
    expect(options.onReveal).toHaveBeenCalledTimes(1);
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
