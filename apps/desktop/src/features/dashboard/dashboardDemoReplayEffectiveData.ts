import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { sliceDemoDashboardReplaySegments } from "./demoDashboardReplay";
import type { DashboardDemoReplayControllerState } from "./useDashboardDemoReplayController";

export type DashboardDemoReplayEffectiveRange = {
  readonly startDay: string;
  readonly endDay: string;
  readonly start: string;
  readonly end: string;
};

type DashboardDemoReplayEffectiveDataInput = {
  readonly replayState: DashboardDemoReplayControllerState;
  readonly selectedDaySegments: ActivitySegment[];
  readonly dashboardSegments: ActivitySegment[];
  readonly currentMinuteOfDay: number | null;
  readonly dashboardRange: DashboardDemoReplayEffectiveRange;
  readonly todayDayForWeekModel: string;
};

type SelectedDayDashboardClassificationOptionsInput = {
  readonly builtInHeuristicsUnavailableSince?: string | null;
  readonly fallbackCandidates: ActivitySegment[];
  readonly includeAiClassifications: boolean;
  readonly includeBuiltInHeuristics?: boolean;
  readonly rules: ClassificationOptions["rules"];
};

export type DashboardDemoReplayEffectiveData = {
  readonly effectiveSelectedDaySegments: ActivitySegment[];
  readonly effectiveDashboardSegments: ActivitySegment[];
  readonly effectiveCurrentMinuteOfDay: number | null;
  readonly effectiveDashboardRange: DashboardDemoReplayEffectiveRange;
  readonly effectiveTodayDayForWeekModel: string;
  readonly isDashboardDemoReplayActive: boolean;
};

export function resolveDashboardDemoReplayEffectiveData(
  input: DashboardDemoReplayEffectiveDataInput,
): DashboardDemoReplayEffectiveData {
  if (input.replayState.kind !== "active") {
    return {
      effectiveSelectedDaySegments: input.selectedDaySegments,
      effectiveDashboardSegments: input.dashboardSegments,
      effectiveCurrentMinuteOfDay: input.currentMinuteOfDay,
      effectiveDashboardRange: input.dashboardRange,
      effectiveTodayDayForWeekModel: input.todayDayForWeekModel,
      isDashboardDemoReplayActive: false,
    };
  }

  const replaySlice = sliceDemoDashboardReplaySegments({
    anchor: input.replayState.anchor,
    progress: input.replayState.progress,
    segments: input.replayState.fixture.segments,
  });

  return {
    effectiveSelectedDaySegments: replaySlice.segments,
    effectiveDashboardSegments: replaySlice.segments,
    effectiveCurrentMinuteOfDay: replaySlice.virtualCurrentMinuteOfDay,
    effectiveDashboardRange: {
      startDay: input.replayState.anchor.startDay,
      endDay: input.replayState.anchor.endDay,
      start: input.replayState.anchor.rangeStart,
      end: input.replayState.anchor.rangeEnd,
    },
    effectiveTodayDayForWeekModel: replaySlice.virtualCurrentDay,
    isDashboardDemoReplayActive: true,
  };
}

export function buildSelectedDayDashboardClassificationOptions(
  input: SelectedDayDashboardClassificationOptionsInput,
): ClassificationOptions {
  return {
    builtInHeuristicsUnavailableSince: input.builtInHeuristicsUnavailableSince,
    fallbackCandidates: input.fallbackCandidates,
    includeAiClassifications: input.includeAiClassifications,
    includeBuiltInHeuristics: input.includeBuiltInHeuristics,
    rules: input.rules,
  };
}

export function isDashboardDemoReplayUpdateDialogBlocking(
  replayState: DashboardDemoReplayControllerState,
): boolean {
  return replayState.kind === "active";
}
