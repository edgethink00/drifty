// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import {
  DAY_REVIEW_TICK_INTERVAL_MS,
  readDayReviewDecisionLog,
  readDayReviewRecord,
  recordDayReviewUnseen,
} from "./dayReviewScheduler";
import { DEFAULT_QUIET_HOURS } from "./quietHours";
import {
  useDayReviewScheduler,
  type DayReviewDeliveryResult,
  type DayReviewPresentationRequest,
  type UseDayReviewSchedulerOptions,
} from "./useDayReviewScheduler";

const DAY = "2026-10-03";

function segment(id: string, durationSeconds: number): ActivitySegment {
  const startedAt = new Date(2026, 9, 3, 9, 0, 0, 0);
  return {
    id,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + durationSeconds * 1000).toISOString(),
    durationSeconds,
    appName: "Code",
    bundleId: "com.microsoft.VSCode",
    windowTitle: "scheduler.ts",
    platform: "macos",
    source: "accessibility",
  } as ActivitySegment;
}

function Host({ options }: { options: UseDayReviewSchedulerOptions }) {
  useDayReviewScheduler(options);
  return null;
}

type Harness = {
  readonly options: UseDayReviewSchedulerOptions;
  readonly present: ReturnType<typeof vi.fn>;
  readonly loadDaySegments: ReturnType<typeof vi.fn>;
  readonly readUserActive: ReturnType<typeof vi.fn>;
};

function harness(overrides: Partial<UseDayReviewSchedulerOptions> = {}, delivery: DayReviewDeliveryResult = "delivered"): Harness {
  const present = vi.fn(async (request: DayReviewPresentationRequest) => request.commitPresentation() ? delivery : "cancelled");
  const loadDaySegments = vi.fn().mockResolvedValue([segment("focus", 4 * 3600)]);
  const readUserActive = vi.fn().mockResolvedValue(true);
  return {
    present,
    loadDaySegments,
    readUserActive,
    options: {
      active: true,
      previewSurface: false,
      dayReviewEnabled: true,
      reviewMinute: 20 * 60,
      startOfDayMinutes: 4 * 60,
      quietHours: DEFAULT_QUIET_HOURS,
      onboardingCompletedAt: null,
      readTimelineRevision: () => 0,
      loadDaySegments,
      readUserActive,
      present,
      ...overrides,
    },
  };
}

function lastDecision() {
  const log = readDayReviewDecisionLog();
  return log[log.length - 1];
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function tick(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DAY_REVIEW_TICK_INTERVAL_MS);
    });
  }
}

describe("useDayReviewScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits on excluded activity and delivers only after valid activity meets the existing bar", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 0, 0));
    const excluded = { ...segment("excluded", 10800), exclusionSource: "user" as const };
    const { options, present, loadDaySegments } = harness();
    loadDaySegments.mockResolvedValue([excluded, segment("valid", 1800)]);
    render(<Host options={options} />);
    await flush();
    expect(present).not.toHaveBeenCalled();
    expect(lastDecision()).toMatchObject({ action: "wait", reason: "thin_day", trackedSeconds: 1800 });
    loadDaySegments.mockResolvedValue([excluded, segment("valid", 10800)]);
    await tick();
    expect(present).toHaveBeenCalledOnce();
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "presented", presentations: 1 });
  });

  it("presents at the review time without any dashboard involvement, then waits for the display report", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 19, 59, 30));
    const { options, present, loadDaySegments } = harness();
    render(<Host options={options} />);
    await flush();
    expect(present).not.toHaveBeenCalled();
    expect(lastDecision()).toMatchObject({ action: "wait", reason: "before_window" });

    await tick();
    expect(present).toHaveBeenCalledTimes(1);
    expect(present.mock.calls[0][0]).toMatchObject({ day: DAY });
    expect(loadDaySegments).toHaveBeenCalledWith(DAY);
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "presented", presentations: 1 });

    await tick(5);
    expect(present).toHaveBeenCalledTimes(1);
    expect(lastDecision()).toMatchObject({ action: "wait", reason: "awaiting_acknowledgement" });
  });

  it("does not count the previous logical day's part of a crossing record toward readiness", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    const crossing = { ...segment("crossing", 14400), startedAt: new Date(2026, 9, 3, 1).toISOString(), endedAt: new Date(2026, 9, 3, 5).toISOString() };
    const { options, present } = harness({ loadDaySegments: async () => [crossing] });
    render(<Host options={options} />);
    await flush();
    expect(present).not.toHaveBeenCalled();
    expect(lastDecision()).toMatchObject({ action: "wait", reason: "thin_day", trackedSeconds: 3600 });
    expect(readDayReviewRecord(DAY)).toBeNull();
  });

  it("acknowledges a browser display immediately", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    const { options } = harness({}, "displayed");
    render(<Host options={options} />);
    await flush();
    expect(readDayReviewRecord(DAY)?.status).toBe("acknowledged");
  });

  it("waits for a thin day and presents the minute it crosses the bar", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    const { options, present, loadDaySegments } = harness();
    loadDaySegments.mockResolvedValue([segment("short", 2 * 3600)]);
    render(<Host options={options} />);
    await flush();
    expect(present).not.toHaveBeenCalled();
    expect(lastDecision()).toMatchObject({ action: "wait", reason: "thin_day" });

    loadDaySegments.mockResolvedValue([segment("long", 3 * 3600)]);
    await tick();
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("holds the card while the user is away and delivers on the first active tick", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    const { options, present, readUserActive, loadDaySegments } = harness();
    readUserActive.mockResolvedValue(false);
    render(<Host options={options} />);
    await flush();
    expect(present).not.toHaveBeenCalled();
    expect(loadDaySegments).not.toHaveBeenCalled();

    readUserActive.mockResolvedValue(true);
    await tick();
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("closes the day two hours before the logical day ends and never revisits it", async () => {
    vi.setSystemTime(new Date(2026, 9, 4, 1, 59, 30));
    const { options, present, loadDaySegments } = harness();
    loadDaySegments.mockResolvedValue([segment("short", 1 * 3600)]);
    render(<Host options={options} />);
    await flush();
    expect(lastDecision()).toMatchObject({ action: "wait", reason: "thin_day" });

    await tick();
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "closed", closedReason: "window_ended" });

    /* Work keeps coming in, but the day is over. */
    loadDaySegments.mockResolvedValue([segment("late", 6 * 3600)]);
    await tick(3);
    expect(present).not.toHaveBeenCalled();
  });

  it("does not offer yesterday on the following day", async () => {
    vi.setSystemTime(new Date(2026, 9, 4, 12, 44));
    const { options, present, loadDaySegments } = harness();
    render(<Host options={options} />);
    await flush();
    await tick(2);
    expect(present).not.toHaveBeenCalled();
    expect(loadDaySegments).not.toHaveBeenCalled();
    expect(lastDecision()).toMatchObject({ day: "2026-10-04", action: "wait", reason: "before_window" });
  });

  it("rebuilds an unseen card once and then closes the day", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    const { options, present } = harness();
    render(<Host options={options} />);
    await flush();
    expect(present).toHaveBeenCalledTimes(1);

    act(() => {
      recordDayReviewUnseen(DAY);
    });
    await tick();
    expect(present).toHaveBeenCalledTimes(2);
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "presented", presentations: 2 });

    act(() => {
      recordDayReviewUnseen(DAY);
    });
    await tick();
    expect(present).toHaveBeenCalledTimes(2);
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "closed", closedReason: "presentation_limit" });
  });

  it("closes the day when the native surface is disabled and retries a dropped payload", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    const disabled = harness({}, "dropped_surface_disabled");
    const { unmount } = render(<Host options={disabled.options} />);
    await flush();
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "closed", closedReason: "surface_disabled" });
    unmount();

    window.localStorage.clear();
    const dropped = harness({}, "dropped_expired");
    render(<Host options={dropped.options} />);
    await flush();
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "pending", presentations: 1 });
    await tick();
    expect(dropped.present).toHaveBeenCalledTimes(2);
  });

  it("stays quiet during quiet hours and delivers once they end", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 21, 59, 30));
    const { options, present } = harness({
      quietHours: { enabled: true, startMinute: 21 * 60, endMinute: 22 * 60 },
    });
    render(<Host options={options} />);
    await flush();
    expect(present).not.toHaveBeenCalled();
    expect(lastDecision()).toMatchObject({ action: "wait", reason: "quiet_hours" });
    await tick();
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates at once when the review time moves into the past", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 21, 0));
    const first = harness({ reviewMinute: 22 * 60 });
    const { rerender } = render(<Host options={first.options} />);
    await flush();
    expect(first.present).not.toHaveBeenCalled();

    rerender(<Host options={{ ...first.options, reviewMinute: 20 * 60 }} />);
    await flush();
    expect(first.present).toHaveBeenCalledTimes(1);
  });

  it("drops a card whose review was switched off during its build", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    let releaseSegments: ((segments: ActivitySegment[]) => void) | undefined;
    const { options, present, loadDaySegments } = harness();
    loadDaySegments.mockImplementation(() => new Promise<ActivitySegment[]>((resolve) => { releaseSegments = resolve; }));
    const { rerender } = render(<Host options={options} />);
    await flush();
    expect(present).not.toHaveBeenCalled();

    rerender(<Host options={{ ...options, dayReviewEnabled: false }} />);
    await act(async () => {
      releaseSegments?.([segment("focus", 4 * 3600)]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(present).not.toHaveBeenCalled();
    expect(readDayReviewRecord(DAY)).toBeNull();
  });

  it("never schedules on a preview surface or while inactive", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    const preview = harness({ previewSurface: true });
    render(<Host options={preview.options} />);
    await flush();
    await tick();
    expect(preview.present).not.toHaveBeenCalled();

    const inactive = harness({ active: false });
    render(<Host options={inactive.options} />);
    await flush();
    await tick();
    expect(inactive.present).not.toHaveBeenCalled();
  });
  it.each(["review time", "quiet hours", "disabled", "expiry", "unmounted", "history"] as const)("cancels preparation after %s changes without spending a delivery", async (change) => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    let timelineRevision = 0;
    const { options, present } = harness({ readTimelineRevision: () => timelineRevision });
    let commit: (() => boolean) | undefined;
    let complete: ((result: DayReviewDeliveryResult) => void) | undefined;
    present.mockImplementation((request: DayReviewPresentationRequest) => {
      commit = request.commitPresentation;
      return new Promise<DayReviewDeliveryResult>((resolve) => { complete = resolve; });
    });
    const { rerender, unmount } = render(<Host options={options} />);
    await flush();
    expect(commit).toBeDefined();
    expect(readDayReviewRecord(DAY)).toBeNull();
    if (change === "review time") rerender(<Host options={{ ...options, reviewMinute: 23 * 60 }} />);
    if (change === "quiet hours") rerender(<Host options={{ ...options, quietHours: { enabled: true, startMinute: 20 * 60, endMinute: 22 * 60 } }} />);
    if (change === "disabled") rerender(<Host options={{ ...options, dayReviewEnabled: false }} />);
    if (change === "expiry") vi.setSystemTime(new Date(2026, 9, 4, 3));
    if (change === "unmounted") unmount();
    if (change === "history") timelineRevision += 1;
    await act(async () => { expect(commit?.()).toBe(false); complete?.("cancelled"); });
    expect(readDayReviewRecord(DAY)?.presentations ?? 0).toBe(0);
    if (change === "unmounted") return;
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    present.mockImplementation(async (request: DayReviewPresentationRequest) => request.commitPresentation() ? "delivered" : "cancelled");
    rerender(<Host options={options} />);
    await tick();
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "presented", presentations: 1 });
    act(() => recordDayReviewUnseen(DAY));
    await tick();
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "presented", presentations: 2 });
    act(() => recordDayReviewUnseen(DAY));
    await tick();
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "closed", closedReason: "presentation_limit" });
  });

  it("discards a stale timeline read and reevaluates the remaining history on the next tick", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    let timelineRevision = 0;
    const { options, present, loadDaySegments } = harness({ readTimelineRevision: () => timelineRevision });
    let finishRead: ((segments: ActivitySegment[]) => void) | undefined;
    loadDaySegments.mockReturnValueOnce(new Promise<ActivitySegment[]>((resolve) => { finishRead = resolve; }));
    render(<Host options={options} />);
    await flush();
    expect(finishRead).toBeDefined();
    timelineRevision += 1;
    loadDaySegments.mockResolvedValue([segment("remaining", 30 * 60)]);
    await act(async () => { finishRead?.([segment("deleted", 4 * 3600)]); });
    expect(present).not.toHaveBeenCalled();
    expect(readDayReviewRecord(DAY)?.presentations ?? 0).toBe(0);
    await tick();
    expect(present).not.toHaveBeenCalled();
    expect(lastDecision()).toMatchObject({ reason: "thin_day", trackedSeconds: 30 * 60 });
    timelineRevision += 1;
    loadDaySegments.mockResolvedValue([segment("new", 4 * 3600)]);
    await tick();
    expect(present).toHaveBeenCalledOnce();
    expect(readDayReviewRecord(DAY)).toMatchObject({ presentations: 1 });
  });

  it("reserves one attempt for native plus plugin checks and refunds an unsent cancellation", async () => {
    vi.setSystemTime(new Date(2026, 9, 3, 20, 5));
    const { options, present } = harness();
    present.mockImplementation(async (request: DayReviewPresentationRequest) => {
      expect(request.commitPresentation()).toBe(true);
      expect(request.commitPresentation()).toBe(true);
      expect(readDayReviewRecord(DAY)?.presentations).toBe(1);
      return "cancelled";
    });
    render(<Host options={options} />);
    await flush();
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "pending", presentations: 0 });
    present.mockImplementation(async (request: DayReviewPresentationRequest) => request.commitPresentation() ? "failed" : "cancelled");
    await tick(2);
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "pending", presentations: 2 });
    await tick();
    expect(readDayReviewRecord(DAY)).toMatchObject({ status: "closed", closedReason: "presentation_limit" });
  });

});


