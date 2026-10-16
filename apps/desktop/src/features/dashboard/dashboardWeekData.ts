import type { ActivitySegment } from "@drifty/domain";
import { filterSegmentsForRange } from "../../lib/formatting";
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
  readonly clipWindow?: { readonly start: number; readonly end: number };
};

export function selectDashboardSegments(input: DashboardSegmentSelectionInput): ActivitySegment[] {
  if (input.dashPeriod === "Today") {
    return filterSegmentsByRange(input.selectedDaySegments, input.visibleRange, input.clipWindow);
  }

  if (input.dashPeriod === "Week") {
    const compactSegments = selectCoveredSourceSegments(input.compactHistorySource, input.requiredHistoryRange, input.visibleRange, input.clipWindow);
    const rangeSegments = compactSegments
      ?? selectCoveredSourceSegments(input.historySource, input.requiredHistoryRange, input.visibleRange, input.clipWindow)
      ?? [];
    const liveSegments = filterSegmentsByRange(input.selectedDaySegments, input.visibleRange, input.clipWindow);
    return mergeActivitySegments(rangeSegments, liveSegments);
  }

  return filterSegmentsByRange(input.historySource?.segments ?? [], input.visibleRange, input.clipWindow);
}

function selectCoveredSourceSegments(
  source: DashboardSegmentSource | null,
  requiredRange: DashboardHistoryRange,
  visibleRange: DashboardHistoryRange,
  clipWindow?: { readonly start: number; readonly end: number },
): ActivitySegment[] | null {
  if (!source?.range) return null;
  if (!rangeContains(source.range, requiredRange)) return null;
  return filterSegmentsByRange(source.segments, visibleRange, clipWindow);
}

function rangeContains(outer: DashboardHistoryRange, inner: DashboardHistoryRange): boolean {
  return Date.parse(outer.start) <= Date.parse(inner.start)
    && Date.parse(outer.end) >= Date.parse(inner.end);
}

function filterSegmentsByRange(
  segments: readonly ActivitySegment[],
  range: DashboardHistoryRange,
  clipWindow?: { readonly start: number; readonly end: number },
): ActivitySegment[] {
  return filterSegmentsForRange(segments, range.start, range.end, clipWindow);
}
