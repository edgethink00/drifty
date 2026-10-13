import { aggregateDeviceElapsedTime, clipDeviceElapsedTimeSegment, sampledActivityTimeBounds, sampledActivitySecondsWithinInterval } from "./deviceElapsedTime";
import { isFailedForegroundCaptureSegment, type ActivitySegment } from "./activity";
import { preserveCapturedActivityDuration } from "./capturedActivityDuration";
import type {
  ProjectAssignmentRecord,
  ProjectWindowAssignmentRecord,
  TeamProjectAssignmentRecord,
} from "./commands";

export interface ProjectSliceProjection {
  /** Virtual activity slices at the persisted window/segment-overlap grain. */
  readonly segments: ActivitySegment[];
  /** Virtual slice id -> assigned project. Missing means No project. */
  readonly projectBySegmentId: Map<string, string>;
  /** Virtual slice id -> original record, for source-scoped activity actions. */
  readonly sourceSegmentIdBySliceId: Map<string, string>;
}

type NormalizedSegmentAssignment = {
  readonly segmentId: string;
  readonly projectId: string | null;
  readonly source: "ai" | "manual";
  readonly stale?: boolean | null;
};

type BuildProjectionInput = {
  readonly scope: "personal" | "team";
  readonly segments: readonly ActivitySegment[];
  readonly windowAssignments: readonly ProjectWindowAssignmentRecord[];
  readonly legacyAssignments: readonly NormalizedSegmentAssignment[];
  readonly projectIdForWindow: (assignment: ProjectWindowAssignmentRecord) => string | null;
};

export function buildPersonalProjectSliceProjection(
  segments: readonly ActivitySegment[],
  windowAssignments: readonly ProjectWindowAssignmentRecord[],
  assignments: readonly ProjectAssignmentRecord[],
): ProjectSliceProjection {
  return buildProjectSliceProjection({
    scope: "personal",
    segments,
    windowAssignments,
    legacyAssignments: assignments,
    projectIdForWindow: (assignment) => assignment.projectId,
  });
}

export function buildTeamProjectSliceProjection(
  segments: readonly ActivitySegment[],
  windowAssignments: readonly ProjectWindowAssignmentRecord[],
  assignments: readonly TeamProjectAssignmentRecord[],
): ProjectSliceProjection {
  return buildProjectSliceProjection({
    scope: "team",
    segments,
    windowAssignments,
    legacyAssignments: assignments.map((assignment) => ({
      segmentId: assignment.segmentId,
      projectId: assignment.teamProjectId,
      source: assignment.source,
      stale: assignment.stale,
    })),
    projectIdForWindow: (assignment) => assignment.teamProjectId,
  });
}

function buildProjectSliceProjection(input: BuildProjectionInput): ProjectSliceProjection {
  // Stored assignments from older Windows builds may still reference failed
  // foreground reads. Hide both those slices and unassigned legacy activity.
  const segments = aggregateDeviceElapsedTime(input.segments)
    .filter((segment) => !isFailedForegroundCaptureSegment(segment))
    .map((segment) => preserveCapturedActivityDuration(segment, segment));
  const sourceById = new Map(segments.map((segment) => [segment.id, segment]));
  const legacyBySegmentId = new Map(
    input.legacyAssignments
      .filter((assignment) => !assignment.stale)
      .map((assignment) => [assignment.segmentId, assignment] as const),
  );
  const manualBySegmentId = new Map(
    input.legacyAssignments
      .filter((assignment) => !assignment.stale && assignment.source === "manual")
      .map((assignment) => [assignment.segmentId, assignment.projectId] as const),
  );
  const coveredSecondsBySourceId = new Map<string, number>();
  const coveredIntervalsBySourceId = new Map<string, Array<{ readonly startMs: number; readonly endMs: number }>>();
  const projectedSegments: ActivitySegment[] = [];
  const projectBySegmentId = new Map<string, string>();
  const sourceSegmentIdBySliceId = new Map<string, string>();

  for (const assignment of [...input.windowAssignments]
    .filter((item) => !item.stale)
    .sort((left, right) => left.windowStartedAt.localeCompare(right.windowStartedAt))) {
    for (const overlap of assignment.segmentOverlaps) {
      const source = sourceById.get(overlap.segmentId);
      if (!source || !(overlap.durationSeconds > 0)) continue;
      const projectId = manualBySegmentId.has(source.id)
        ? manualBySegmentId.get(source.id) ?? null
        : input.projectIdForWindow(assignment);
      const intervals = coveredIntervalsBySourceId.get(source.id) ?? [];
      const bounds = clippedBounds(source, assignment.windowStartedAt, assignment.windowEndedAt);
      const windowStart = Date.parse(bounds.startedAt);
      const windowEnd = Date.parse(bounds.endedAt);
      if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) continue;
      const gaps = uncoveredBounds(source, intervals).flatMap(gap => {
        const startMs = Math.max(windowStart, gap.startMs);
        const endMs = Math.min(windowEnd, gap.endMs);
        return endMs > startMs ? [{ startMs, endMs }] : [];
      });
      for (const [index, gap] of gaps.entries()) {
        const sliceId = `project-window:${input.scope}:${assignment.windowStartedAt}:${source.id}${gaps.length > 1 ? ":" + index : ""}`;
        // Persisted overlap seconds were historically wall-clock seconds. The
        // local source sample and window bounds own the time budget, including
        // already-saved windows. Do not allocate an interval twice.
        const seconds = sampledActivitySecondsWithinInterval(source, gap.startMs, gap.endMs);
        if (!(seconds > 0)) continue;
        const slice = clipDeviceElapsedTimeSegment({
          ...source,
          id: sliceId,
          startedAt: new Date(gap.startMs).toISOString(),
          endedAt: new Date(gap.endMs).toISOString(),
          durationSeconds: seconds,
        });
        intervals.push(gap);
        coveredIntervalsBySourceId.set(source.id, intervals);
        coveredSecondsBySourceId.set(source.id, (coveredSecondsBySourceId.get(source.id) ?? 0) + slice.durationSeconds);
        projectedSegments.push(slice);
        sourceSegmentIdBySliceId.set(sliceId, source.id);
        if (projectId) projectBySegmentId.set(sliceId, projectId);
      }
    }
  }

  // Backward-compatible projection for ranges not yet re-analyzed by the new
  // fixed-window pass. A legacy row fills only the source duration not covered by
  // stored windows; a legacy manual row still overrides each covered slice above.
  for (const source of segments) {
    const remainingSeconds = Math.max(
      0,
      source.durationSeconds - (coveredSecondsBySourceId.get(source.id) ?? 0),
    );
    if (!(remainingSeconds > 0)) continue;
    const projectId = legacyBySegmentId.get(source.id)?.projectId ?? null;
    const gaps = uncoveredBounds(source, coveredIntervalsBySourceId.get(source.id) ?? []);
    const weightedGaps = allocateDurationAcrossGaps(gaps, remainingSeconds);
    if (weightedGaps.length === 0) {
      const sliceId = `project-window:${input.scope}:legacy:${source.id}`;
      projectedSegments.push({ ...source, id: sliceId, durationSeconds: remainingSeconds });
      sourceSegmentIdBySliceId.set(sliceId, source.id);
      if (projectId) projectBySegmentId.set(sliceId, projectId);
      continue;
    }
    for (const [index, gap] of weightedGaps.entries()) {
      const sliceId = `project-window:${input.scope}:legacy:${source.id}:${index}`;
      projectedSegments.push(clipDeviceElapsedTimeSegment({
        ...source,
        id: sliceId,
        startedAt: new Date(gap.startMs).toISOString(),
        endedAt: new Date(gap.endMs).toISOString(),
        durationSeconds: gap.durationSeconds,
      }));
      sourceSegmentIdBySliceId.set(sliceId, source.id);
      if (projectId) projectBySegmentId.set(sliceId, projectId);
    }
  }

  return {
    segments: projectedSegments,
    projectBySegmentId,
    sourceSegmentIdBySliceId,
  };
}

function uncoveredBounds(
  source: ActivitySegment,
  coveredIntervals: readonly { readonly startMs: number; readonly endMs: number }[],
): Array<{ readonly startMs: number; readonly endMs: number }> {
  const { start: sourceStartMs, end: sourceEndMs } = sampledActivityTimeBounds(source);
  if (!Number.isFinite(sourceStartMs) || !Number.isFinite(sourceEndMs) || sourceEndMs <= sourceStartMs) return [];

  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const interval of [...coveredIntervals].sort((left, right) => left.startMs - right.startMs)) {
    const startMs = Math.max(sourceStartMs, interval.startMs);
    const endMs = Math.min(sourceEndMs, interval.endMs);
    if (endMs <= startMs) continue;
    const previous = merged[merged.length - 1];
    if (previous && startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, endMs);
    } else {
      merged.push({ startMs, endMs });
    }
  }

  const gaps: Array<{ readonly startMs: number; readonly endMs: number }> = [];
  let cursorMs = sourceStartMs;
  for (const interval of merged) {
    if (interval.startMs > cursorMs) gaps.push({ startMs: cursorMs, endMs: interval.startMs });
    cursorMs = Math.max(cursorMs, interval.endMs);
  }
  if (cursorMs < sourceEndMs) gaps.push({ startMs: cursorMs, endMs: sourceEndMs });
  return gaps;
}

function allocateDurationAcrossGaps(
  gaps: readonly { readonly startMs: number; readonly endMs: number }[],
  totalSeconds: number,
): Array<{ readonly startMs: number; readonly endMs: number; readonly durationSeconds: number }> {
  const totalGapMs = gaps.reduce((sum, gap) => sum + Math.max(0, gap.endMs - gap.startMs), 0);
  if (!(totalGapMs > 0) || !(totalSeconds > 0)) return [];

  let allocatedSeconds = 0;
  return gaps.flatMap((gap, index) => {
    const availableSeconds = totalSeconds - allocatedSeconds;
    if (!(availableSeconds > 0)) return [];
    const durationSeconds = index === gaps.length - 1
      ? availableSeconds
      : Math.min(availableSeconds, Math.max(0, totalSeconds * ((gap.endMs - gap.startMs) / totalGapMs)));
    if (!(durationSeconds > 0)) return [];
    allocatedSeconds += durationSeconds;
    return [{ ...gap, durationSeconds }];
  });
}

function clippedBounds(
  source: ActivitySegment,
  windowStartedAt: string,
  windowEndedAt: string,
): { readonly startedAt: string; readonly endedAt: string } {
  const { start: sourceStart, end: sourceEnd } = sampledActivityTimeBounds(source);
  const windowStart = Date.parse(windowStartedAt);
  const windowEnd = Date.parse(windowEndedAt);
  if ([sourceStart, sourceEnd, windowStart, windowEnd].some(Number.isNaN)) {
    return { startedAt: windowStartedAt, endedAt: windowEndedAt };
  }
  return {
    startedAt: new Date(Math.max(sourceStart, windowStart)).toISOString(),
    endedAt: new Date(Math.min(sourceEnd, windowEnd)).toISOString(),
  };
}
