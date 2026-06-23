import type { ActivitySegment } from "@drifty/domain";
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
    return mergeDashboardSegments(rangeSegments, liveSegments);
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

function mergeDashboardSegments(baseSegments: readonly ActivitySegment[], liveSegments: readonly ActivitySegment[]): ActivitySegment[] {
  if (liveSegments.length === 0) return [...baseSegments];

  const segmentsById = new Map<string, ActivitySegment>();
  for (const segment of baseSegments) {
    segmentsById.set(segment.id, segment);
  }
  for (const segment of liveSegments) {
    const existing = segmentsById.get(segment.id) ?? null;
    segmentsById.set(segment.id, existing ? selectDashboardSegment(existing, segment) : segment);
  }

  return Array.from(segmentsById.values());
}

function selectDashboardSegment(existing: ActivitySegment, incoming: ActivitySegment): ActivitySegment {
  const existingEndedAtMs = new Date(existing.endedAt).getTime();
  const incomingEndedAtMs = new Date(incoming.endedAt).getTime();

  if (Number.isFinite(existingEndedAtMs) && Number.isFinite(incomingEndedAtMs)) {
    if (incomingEndedAtMs > existingEndedAtMs) return preserveClassification(incoming, existing);
    if (incomingEndedAtMs < existingEndedAtMs) return existing;
  }

  if (existing.classification && !incoming.classification) return existing;
  return incoming;
}

function preserveClassification(segment: ActivitySegment, fallbackSegment: ActivitySegment): ActivitySegment {
  if (segment.classification || !fallbackSegment.classification) return segment;
  return { ...segment, classification: fallbackSegment.classification };
}
