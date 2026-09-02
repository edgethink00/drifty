import type {
  ActivitySegment,
  ProjectAssignmentRecord,
  ProjectWindowAssignmentRecord,
} from "@drifty/domain";

type ProjectAssignmentSummary = {
  readonly projectId: string | null;
  readonly hasMixedProject: boolean;
};

function latestAssignmentBySource(
  assignments: readonly ProjectAssignmentRecord[],
  source: ProjectAssignmentRecord["source"],
): Map<string, ProjectAssignmentRecord> {
  const result = new Map<string, ProjectAssignmentRecord>();
  for (const assignment of assignments) {
    if (assignment.stale || assignment.source !== source) continue;
    const current = result.get(assignment.segmentId);
    if (!current || (assignment.assignedAt ?? "") >= (current.assignedAt ?? "")) {
      result.set(assignment.segmentId, assignment);
    }
  }
  return result;
}

/**
 * Resolves the project shown on a source activity record. Manual segment-level
 * choices override every AI window. Otherwise, the project with the greatest
 * overlap wins, with the legacy row filling any duration not covered by window
 * assignments. A null value is intentional and represents “No project”.
 */
export function buildDashboardProjectBySegmentId(
  segments: readonly ActivitySegment[],
  assignments: readonly ProjectAssignmentRecord[],
  windowAssignments: readonly ProjectWindowAssignmentRecord[],
): Map<string, string | null> {
  const manualBySegmentId = latestAssignmentBySource(assignments, "manual");
  const legacyAiBySegmentId = latestAssignmentBySource(assignments, "ai");
  const windowsBySegmentId = new Map<string, Array<{ readonly projectId: string | null; readonly seconds: number; readonly order: number }>>();

  for (const [order, assignment] of [...windowAssignments]
    .filter((item) => !item.stale)
    .sort((left, right) => left.windowStartedAt.localeCompare(right.windowStartedAt))
    .entries()) {
    for (const overlap of assignment.segmentOverlaps) {
      if (!(overlap.durationSeconds > 0)) continue;
      const windows = windowsBySegmentId.get(overlap.segmentId) ?? [];
      windows.push({ projectId: assignment.projectId, seconds: overlap.durationSeconds, order });
      windowsBySegmentId.set(overlap.segmentId, windows);
    }
  }

  const result = new Map<string, string | null>();
  for (const segment of segments) {
    const manual = manualBySegmentId.get(segment.id);
    if (manual) {
      result.set(segment.id, manual.projectId);
      continue;
    }

    const weights = new Map<string, { readonly projectId: string | null; seconds: number; order: number }>();
    let coveredSeconds = 0;
    for (const window of windowsBySegmentId.get(segment.id) ?? []) {
      const key = window.projectId ?? "__no_project__";
      const current = weights.get(key) ?? { projectId: window.projectId, seconds: 0, order: window.order };
      current.seconds += window.seconds;
      current.order = Math.max(current.order, window.order);
      weights.set(key, current);
      coveredSeconds += window.seconds;
    }

    const remainingSeconds = Math.max(0, segment.durationSeconds - coveredSeconds);
    if (remainingSeconds > 0 || weights.size === 0) {
      const projectId = legacyAiBySegmentId.get(segment.id)?.projectId ?? null;
      const key = projectId ?? "__no_project__";
      const current = weights.get(key) ?? { projectId, seconds: 0, order: -1 };
      current.seconds += remainingSeconds > 0 ? remainingSeconds : segment.durationSeconds;
      weights.set(key, current);
    }

    let winner: { readonly projectId: string | null; seconds: number; order: number } | null = null;
    for (const candidate of weights.values()) {
      if (!winner || candidate.seconds > winner.seconds || (candidate.seconds === winner.seconds && candidate.order > winner.order)) {
        winner = candidate;
      }
    }
    result.set(segment.id, winner?.projectId ?? null);
  }
  return result;
}

export function summarizeDashboardActivityProject(
  segmentIds: readonly string[],
  segmentsById: ReadonlyMap<string, ActivitySegment>,
  projectBySegmentId: ReadonlyMap<string, string | null>,
): ProjectAssignmentSummary {
  const weights = new Map<string, { readonly projectId: string | null; seconds: number; order: number }>();
  const distinctProjects = new Set<string>();

  for (const [order, segmentId] of segmentIds.entries()) {
    const segment = segmentsById.get(segmentId);
    if (!segment) continue;
    const projectId = projectBySegmentId.get(segmentId) ?? null;
    const key = projectId ?? "__no_project__";
    const current = weights.get(key) ?? { projectId, seconds: 0, order };
    current.seconds += Math.max(0, segment.durationSeconds);
    current.order = order;
    weights.set(key, current);
    distinctProjects.add(key);
  }

  let winner: { readonly projectId: string | null; seconds: number; order: number } | null = null;
  for (const candidate of weights.values()) {
    if (!winner || candidate.seconds > winner.seconds || (candidate.seconds === winner.seconds && candidate.order > winner.order)) {
      winner = candidate;
    }
  }

  return {
    projectId: winner?.projectId ?? null,
    hasMixedProject: distinctProjects.size > 1,
  };
}
