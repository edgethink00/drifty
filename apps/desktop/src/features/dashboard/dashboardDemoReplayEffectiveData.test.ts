import { buildFlowBlocks, totalDurationSeconds, type ActivitySegment, type ClassificationRuleOption } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildFocusDriftChart } from "./focusDriftChart";
import { buildDemoDashboardReplayAnchor, buildDemoDashboardReplayFixture } from "./demoDashboardReplay";
import {
  buildSelectedDayDashboardClassificationOptions,
  isDashboardDemoReplayUpdateDialogBlocking,
  resolveDashboardDemoReplayEffectiveData,
} from "./dashboardDemoReplayEffectiveData";
import type { DashboardDemoReplayActiveState, DashboardDemoReplayControllerState } from "./useDashboardDemoReplayController";

const LIVE_RANGE = {
  startDay: "2026-06-18",
  endDay: "2026-06-18",
  start: "2026-06-18T04:00:00",
  end: "2026-06-19T03:59:59",
};

const EMPTY_SEGMENTS: ActivitySegment[] = [];
const RULE_BACKED_SEGMENT: ActivitySegment = {
  id: "rule-backed-segment",
  startedAt: "2026-06-18T10:00:00",
  endedAt: "2026-06-18T10:30:00",
  durationSeconds: 30 * 60,
  appName: "Rule Studio",
  bundleId: "com.drifty.synthetic.rule-studio",
  windowTitle: "Rule-backed activity",
  platform: "macos",
  source: "manual",
};
const DRIFT_RULES: ClassificationRuleOption[] = [{
  targetKind: "app",
  targetValue: "Rule Studio",
  category: "learning",
  productivity: "drift",
}];

function buildActiveReplayState(progress: number): DashboardDemoReplayActiveState {
  const anchor = buildDemoDashboardReplayAnchor({
    kind: "day",
    currentLogicalDay: "2026-06-18",
    startOfDayMinutes: 240,
    startOfWeek: "monday",
  });
  const fixture = buildDemoDashboardReplayFixture(anchor);
  return {
    kind: "active",
    anchor,
    fixture,
    phase: progress >= 1 ? "complete" : "playing",
    playingStartedAtMs: 0,
    progress,
    replayKind: "day",
    runId: 1,
    settings: { preRollSeconds: 5, durationSeconds: 45 },
  };
}

describe("resolveDashboardDemoReplayEffectiveData", () => {
  it("preserves inactive live dashboard inputs by reference", () => {
    // Given
    const liveSelectedDaySegments: ActivitySegment[] = [];
    const liveDashboardSegments: ActivitySegment[] = [];

    // When
    const effectiveData = resolveDashboardDemoReplayEffectiveData({
      currentMinuteOfDay: null,
      dashboardRange: LIVE_RANGE,
      dashboardSegments: liveDashboardSegments,
      replayState: { kind: "idle" },
      selectedDaySegments: liveSelectedDaySegments,
      todayDayForWeekModel: "2026-06-18",
    });

    // Then
    expect(effectiveData.isDashboardDemoReplayActive).toBe(false);
    expect(effectiveData.effectiveSelectedDaySegments).toBe(liveSelectedDaySegments);
    expect(effectiveData.effectiveDashboardSegments).toBe(liveDashboardSegments);
    expect(effectiveData.effectiveDashboardRange).toBe(LIVE_RANGE);
    expect(effectiveData.effectiveCurrentMinuteOfDay).toBeNull();
    expect(effectiveData.effectiveTodayDayForWeekModel).toBe("2026-06-18");
  });

  it("derives non-empty mid-replay dashboard data without live tracker segments", () => {
    // Given
    const replayState = buildActiveReplayState(0.5);

    // When
    const effectiveData = resolveDashboardDemoReplayEffectiveData({
      currentMinuteOfDay: null,
      dashboardRange: LIVE_RANGE,
      dashboardSegments: EMPTY_SEGMENTS,
      replayState,
      selectedDaySegments: EMPTY_SEGMENTS,
      todayDayForWeekModel: "2026-06-29",
    });

    // Then
    expect(effectiveData.isDashboardDemoReplayActive).toBe(true);
    expect(effectiveData.effectiveSelectedDaySegments.length).toBeGreaterThan(0);
    expect(totalDurationSeconds(effectiveData.effectiveDashboardSegments)).toBeGreaterThan(0);
    expect(totalDurationSeconds(effectiveData.effectiveDashboardSegments)).toBeLessThan(replayState.fixture.totalSeconds);
    expect(effectiveData.effectiveDashboardRange).toEqual({
      startDay: replayState.anchor.startDay,
      endDay: replayState.anchor.endDay,
      start: replayState.anchor.rangeStart,
      end: replayState.anchor.rangeEnd,
    });
  });

  it("matches the fixture total when replay completes", () => {
    // Given
    const replayState = buildActiveReplayState(1);

    // When
    const effectiveData = resolveDashboardDemoReplayEffectiveData({
      currentMinuteOfDay: 840,
      dashboardRange: LIVE_RANGE,
      dashboardSegments: EMPTY_SEGMENTS,
      replayState,
      selectedDaySegments: EMPTY_SEGMENTS,
      todayDayForWeekModel: "2026-06-29",
    });

    // Then
    expect(totalDurationSeconds(effectiveData.effectiveDashboardSegments)).toBe(replayState.fixture.totalSeconds);
    expect(effectiveData.effectiveCurrentMinuteOfDay).toBe(3 * 60 + 59);
    expect(effectiveData.effectiveTodayDayForWeekModel).toBe(replayState.anchor.endDay);
  });

  it("does not mutate supplied live data arrays when replay is active", () => {
    // Given
    const liveSelectedDaySegments: ActivitySegment[] = [];
    const liveDashboardSegments: ActivitySegment[] = [];

    // When
    const effectiveData = resolveDashboardDemoReplayEffectiveData({
      currentMinuteOfDay: 720,
      dashboardRange: LIVE_RANGE,
      dashboardSegments: liveDashboardSegments,
      replayState: buildActiveReplayState(0.5),
      selectedDaySegments: liveSelectedDaySegments,
      todayDayForWeekModel: "2026-06-29",
    });

    // Then
    expect(liveSelectedDaySegments).toHaveLength(0);
    expect(liveDashboardSegments).toHaveLength(0);
    expect(effectiveData.effectiveSelectedDaySegments).not.toBe(liveSelectedDaySegments);
    expect(effectiveData.effectiveDashboardSegments).not.toBe(liveDashboardSegments);
  });

  it("blocks update dialogs only while replay is active", () => {
    // Given
    const activeReplayState = buildActiveReplayState(0);
    const inactiveReplayState: DashboardDemoReplayControllerState = { kind: "idle" };

    // When
    const activeResult = isDashboardDemoReplayUpdateDialogBlocking(activeReplayState);
    const inactiveResult = isDashboardDemoReplayUpdateDialogBlocking(inactiveReplayState);

    // Then
    expect(activeResult).toBe(true);
    expect(inactiveResult).toBe(false);
  });

  it("preserves selected-day classification rules for selected-day dashboard builders", () => {
    // Given
    const options = buildSelectedDayDashboardClassificationOptions({
      fallbackCandidates: [RULE_BACKED_SEGMENT],
      includeAiClassifications: true,
      rules: DRIFT_RULES,
    });

    // When
    const flowBlocks = buildFlowBlocks([RULE_BACKED_SEGMENT], "2026-06-18", 5, options);
    const focusDriftChart = buildFocusDriftChart([RULE_BACKED_SEGMENT], "2026-06-18", options);

    // Then
    expect(options.rules).toBe(DRIFT_RULES);
    expect(flowBlocks[0]?.category).toBe("learning");
    expect(flowBlocks[0]?.productivity).toBe("drift");
    expect(focusDriftChart.peakDriftPoint?.driftSeconds).toBe(RULE_BACKED_SEGMENT.durationSeconds);
  });
});
