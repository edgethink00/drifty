// @vitest-environment jsdom
import type { ActivitySegment } from "@drifty/domain";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSelectedDashboardReplayAnchor } from "./dashboardDemoReplaySource";
import { useDashboardDemoReplayController, type DashboardDemoReplayControllerState } from "./useDashboardDemoReplayController";

const TEST_SETTINGS = { preRollSeconds: 2, durationSeconds: 15 };

function expectActive(state: DashboardDemoReplayControllerState) {
  if (state.kind !== "active") {
    throw new Error(`Expected active replay state, received ${state.kind}`);
  }
  return state;
}

function renderController() {
  const selectedDays: string[] = [];
  const dashboardPeriods: string[] = [];

  const hook = renderHook(() => useDashboardDemoReplayController({
    settings: TEST_SETTINGS,
    startOfDayMinutes: 240,
    startOfWeek: "monday",
    onSelectDay: (day) => selectedDays.push(day),
    onNavigateDashboard: (period) => dashboardPeriods.push(period),
  }));

  return { dashboardPeriods, hook, selectedDays };
}

function actualReplaySegment(): ActivitySegment {
  return {
    id: "actual-replay-focus",
    startedAt: "2026-06-20T10:00:00",
    endedAt: "2026-06-20T10:10:00",
    durationSeconds: 10 * 60,
    appName: "Actual Studio",
    bundleId: "com.drifty.actual.studio",
    windowTitle: "Actual selected day work",
    platform: "macos",
    source: "manual",
    classification: {
      category: "workspace",
      productivity: "focus",
      source: "manual",
      confidence: 1,
      reason: "Actual selected replay segment.",
    },
  };
}

describe("useDashboardDemoReplayController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Given a day replay When started Then pre-roll holds progress at zero before playing advances to complete", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T12:00:00"));
    const { dashboardPeriods, hook, selectedDays } = renderController();

    act(() => hook.result.current.startReplay("day"));

    const preRollState = expectActive(hook.result.current.replayState);
    expect(preRollState.phase).toBe("pre_roll");
    expect(preRollState.progress).toBe(0);
    expect(preRollState.anchor.anchorDay).toBe("2026-06-18");
    expect(selectedDays).toEqual(["2026-06-18"]);
    expect(dashboardPeriods).toEqual(["Today"]);

    act(() => vi.advanceTimersByTime(1_999));

    const heldState = expectActive(hook.result.current.replayState);
    expect(heldState.phase).toBe("pre_roll");
    expect(heldState.progress).toBe(0);

    act(() => vi.advanceTimersByTime(1));
    act(() => vi.advanceTimersByTime(1_000));

    const playingState = expectActive(hook.result.current.replayState);
    expect(playingState.phase).toBe("playing");
    expect(playingState.progress).toBeGreaterThan(0);
    expect(playingState.progress).toBeLessThan(1);

    act(() => vi.advanceTimersByTime(14_000));

    const completeState = expectActive(hook.result.current.replayState);
    expect(completeState.phase).toBe("complete");
    expect(completeState.progress).toBe(1);
  });

  it("Given a week replay When started Then it anchors to the last completed week and opens the Week dashboard", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T12:00:00"));
    const { dashboardPeriods, hook, selectedDays } = renderController();

    act(() => hook.result.current.startReplay("week"));

    const state = expectActive(hook.result.current.replayState);
    expect(state.anchor).toMatchObject({
      kind: "week",
      anchorDay: "2026-06-14",
      startDay: "2026-06-08",
      endDay: "2026-06-14",
    });
    expect(selectedDays).toEqual(["2026-06-14"]);
    expect(dashboardPeriods).toEqual(["Week"]);
  });

  it("Given selected replay source When started Then fixture uses actual source segments", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T12:00:00"));
    const { dashboardPeriods, hook, selectedDays } = renderController();
    const anchor = buildSelectedDashboardReplayAnchor({
      kind: "day",
      anchorDay: "2026-06-20",
      startDay: "2026-06-20",
      endDay: "2026-06-20",
      startOfDayMinutes: 240,
    });

    act(() => hook.result.current.startReplay("day", { anchor, segments: [actualReplaySegment()] }));

    const state = expectActive(hook.result.current.replayState);
    expect(state.anchor).toBe(anchor);
    expect(state.fixture.segments.map((segment) => segment.appName)).toEqual(["Actual Studio"]);
    expect(state.fixture.totalSeconds).toBe(10 * 60);
    expect(selectedDays).toEqual(["2026-06-20"]);
    expect(dashboardPeriods).toEqual(["Today"]);
  });

  it("Given out-of-range settings When started Then controller state stores clamped timer settings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T12:00:00"));
    const hook = renderHook(() => useDashboardDemoReplayController({
      settings: { preRollSeconds: -1, durationSeconds: 999 },
      startOfDayMinutes: 240,
      startOfWeek: "monday",
      onSelectDay: () => undefined,
      onNavigateDashboard: () => undefined,
    }));

    act(() => hook.result.current.startReplay("day"));

    const state = expectActive(hook.result.current.replayState);
    expect(state.settings).toEqual({ preRollSeconds: 0, durationSeconds: 180 });
  });

  it("Given active timers When stopped during pre-roll or playing Then later timer ticks do not change idle state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T12:00:00"));
    const { hook } = renderController();

    act(() => hook.result.current.startReplay("day"));
    act(() => hook.result.current.stopReplay());
    act(() => vi.advanceTimersByTime(10_000));

    expect(hook.result.current.replayState).toEqual({ kind: "idle" });

    act(() => hook.result.current.startReplay("day"));
    act(() => vi.advanceTimersByTime(2_250));

    expect(expectActive(hook.result.current.replayState).phase).toBe("playing");

    act(() => hook.result.current.stopReplay());
    act(() => vi.advanceTimersByTime(10_000));

    expect(hook.result.current.replayState).toEqual({ kind: "idle" });
  });

  it("Given a playing replay When restarted Then it returns to progress zero with the same kind and settings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T12:00:00"));
    const { hook } = renderController();

    act(() => hook.result.current.startReplay("week"));
    act(() => vi.advanceTimersByTime(2_250));

    const beforeRestart = expectActive(hook.result.current.replayState);
    expect(beforeRestart.phase).toBe("playing");
    expect(beforeRestart.settings).toEqual(TEST_SETTINGS);

    act(() => hook.result.current.restartReplay());

    const restarted = expectActive(hook.result.current.replayState);
    expect(restarted.phase).toBe("pre_roll");
    expect(restarted.progress).toBe(0);
    expect(restarted.replayKind).toBe("week");
    expect(restarted.settings).toEqual(TEST_SETTINGS);
  });
});
