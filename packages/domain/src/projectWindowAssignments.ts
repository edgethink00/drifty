import { clipDeviceElapsedTimeSegment } from "./deviceElapsedTime";
import { isFailedForegroundCaptureSegment, type ActivitySegment } from "./activity";
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
  const segments = input.segments.filter((segment) => !isFailedForegroundCaptureSegment(segment));
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

  for (const assignment of [...input.windowAssignments]
    .filter((item) => !item.stale)
    .sort((left, right) => left.windowStartedAt.localeCompare(right.windowStartedAt))) {
    for (const overlap of assignment.segmentOverlaps) {
      const source = sourceById.get(overlap.segmentId);
      if (!source || !(overlap.durationSeconds > 0)) continue;
      const projectId = manualBySegmentId.has(source.id)
        ? manualBySegmentId.get(source.id) ?? null
        : input.projectIdForWindow(assignment);
      const sliceId = `project-window:${input.scope}:${assignment.windowStartedAt}:${source.id}`;
      const bounds = clippedBounds(source, assignment.windowStartedAt, assignment.windowEndedAt);
      const boundsStartMs = Date.parse(bounds.startedAt);
      const boundsEndMs = Date.parse(bounds.endedAt);
      if (Number.isFinite(boundsStartMs) && Number.isFinite(boundsEndMs) && boundsEndMs > boundsStartMs) {
        const intervals = coveredIntervalsBySourceId.get(source.id) ?? [];
        intervals.push({ startMs: boundsStartMs, endMs: boundsEndMs });
        coveredIntervalsBySourceId.set(source.id, intervals);
      }
      const slice = clipDeviceElapsedTimeSegment({
        ...source,
        id: sliceId,
        startedAt: bounds.startedAt,
        endedAt: bounds.endedAt,
        durationSeconds: overlap.durationSeconds,
      });
      coveredSecondsBySourceId.set(source.id, (coveredSecondsBySourceId.get(source.id) ?? 0) + slice.durationSeconds);
      projectedSegments.push(slice);
      if (projectId) projectBySegmentId.set(sliceId, projectId);
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
      if (projectId) projectBySegmentId.set(sliceId, projectId);
    }
  }

  return {
    segments: projectedSegments,
    projectBySegmentId,
  };
}

function uncoveredBounds(
  source: ActivitySegment,
  coveredIntervals: readonly { readonly startMs: number; readonly endMs: number }[],
): Array<{ readonly startMs: number; readonly endMs: number }> {
  const sourceStartMs = Date.parse(source.startedAt);
  const sourceEndMs = Date.parse(source.endedAt);
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
      : Math.min(availableSeconds, Math.max(0, Math.round(totalSeconds * ((gap.endMs - gap.startMs) / totalGapMs))));
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
  const sourceStart = Date.parse(source.startedAt);
  const sourceEnd = Date.parse(source.endedAt);
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
