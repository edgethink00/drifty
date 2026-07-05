import type { ActivitySegment } from "@drifty/domain";
import { mergeActivitySegments } from "../../lib/activitySegments";
import type { DashboardPeriod } from "./dashboardPeriods";

export type DashboardSegmentRange = {
  readonly start: string;
  readonly end: string;
  readonly startDay: string;
  readonly endDay: string;
};

export type DashboardHistoryRange = {
  readonly start: string;
  readonly end: string;
};

export type DashboardSegmentSource = {
  readonly range: DashboardHistoryRange | null;
  readonly segments: readonly ActivitySegment[];
};

export type DashboardSegmentSelectionInput = {
  readonly compactHistorySource: DashboardSegmentSource | null;
  readonly dashPeriod: DashboardPeriod;
  readonly historySource: DashboardSegmentSource | null;
  readonly requiredHistoryRange: DashboardHistoryRange;
  readonly selectedDaySegments: readonly ActivitySegment[];
  readonly visibleRange: DashboardSegmentRange;
};

export function selectDashboardSegments(input: DashboardSegmentSelectionInput): ActivitySegment[] {
  if (input.dashPeriod === "Today") {
    return filterSegmentsByRange(input.selectedDaySegments, input.visibleRange);
  }

  if (input.dashPeriod === "Week") {
    const compactSegments = selectCoveredSourceSegments(input.compactHistorySource, input.requiredHistoryRange, input.visibleRange);
    const rangeSegments = compactSegments
      ?? selectCoveredSourceSegments(input.historySource, input.requiredHistoryRange, input.visibleRange)
      ?? [];
    const liveSegments = filterSegmentsByRange(input.selectedDaySegments, input.visibleRange);
    return mergeActivitySegments(rangeSegments, liveSegments);
  }

  return filterSegmentsByRange(input.historySource?.segments ?? [], input.visibleRange);
}

function selectCoveredSourceSegments(
  source: DashboardSegmentSource | null,
  requiredRange: DashboardHistoryRange,
  visibleRange: DashboardHistoryRange,
): ActivitySegment[] | null {
  if (!source?.range) return null;
  if (!rangeContains(source.range, requiredRange)) return null;
  return filterSegmentsByRange(source.segments, visibleRange);
}

function rangeContains(outer: DashboardHistoryRange, inner: DashboardHistoryRange): boolean {
  return new Date(outer.start).getTime() <= new Date(inner.start).getTime()
    && new Date(outer.end).getTime() >= new Date(inner.end).getTime();
}

function filterSegmentsByRange(segments: readonly ActivitySegment[], range: DashboardHistoryRange): ActivitySegment[] {
  const startMs = new Date(range.start).getTime();
  const endMs = new Date(range.end).getTime();

  return segments.filter((segment) => {
    const segmentStartMs = new Date(segment.startedAt).getTime();
    const segmentEndMs = new Date(segment.endedAt).getTime();
    return segmentEndMs >= startMs && segmentStartMs <= endMs;
  });
}
