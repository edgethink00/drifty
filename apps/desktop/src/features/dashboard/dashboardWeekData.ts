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
  return Date.parse(outer.start) <= Date.parse(inner.start)
    && Date.parse(outer.end) >= Date.parse(inner.end);
}

function filterSegmentsByRange(segments: readonly ActivitySegment[], range: DashboardHistoryRange): ActivitySegment[] {
  const startMs = Date.parse(range.start);
  const endMs = Date.parse(range.end);

  return segments.filter((segment) => {
    const segmentStartMs = Date.parse(segment.startedAt);
    const segmentEndMs = Date.parse(segment.endedAt);
    return segmentEndMs >= startMs && segmentStartMs <= endMs;
  });
}
