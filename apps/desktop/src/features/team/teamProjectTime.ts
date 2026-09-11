import {
  buildTeamProjectSliceProjection,
  isExcludedSegment,
  isPassiveSupportedSegment,
  isRemoteDeviceSegment,
  logicalDayIsoDateForDate,
  type ActivitySegment,
  type ProjectWindowAssignmentRecord,
  type TeamProjectAssignmentRecord,
} from "@drifty/domain";
import type { TeamProjectTotalsEntry } from "./teamTypes";

// Aggregate a member's locally-stored team-project assignments into publish-ready
// per-project, per-day second totals.
//
// The heavy AI pass classifies the member's own activity into team projects (union
// pass) and stores the assignments locally in `team_project_assignments`. Publishing
// reads those stored assignments + the local timeline and sums seconds per project
// per logical day. Only these aggregate seconds are published upward — raw activity
// (apps, titles, urls) never leaves the Mac.

export function aggregateTeamProjectDayTotals(
  assignments: readonly TeamProjectAssignmentRecord[],
  segments: readonly ActivitySegment[],
  startOfDayMinutes = 0,
  windowAssignments: readonly ProjectWindowAssignmentRecord[] = [],
): TeamProjectTotalsEntry[] {
  const localSegments = segments.filter(
    (segment) => !isRemoteDeviceSegment(segment) && !isPassiveSupportedSegment(segment) && !isExcludedSegment(segment),
  );
  const projection = buildTeamProjectSliceProjection(localSegments, windowAssignments, assignments);

  const totals = new Map<string, number>();
  for (const segment of projection.segments) {
    const projectId = projection.projectBySegmentId.get(segment.id);
    if (!projectId) continue;
    const seconds = segment.durationSeconds ?? 0;
    if (seconds <= 0) continue;
    const day = logicalDayIsoDateForDate(new Date(segment.startedAt), startOfDayMinutes);
    const key = `${projectId}\n${day}`;
    totals.set(key, (totals.get(key) ?? 0) + seconds);
  }

  const entries: TeamProjectTotalsEntry[] = [];
  for (const [key, seconds] of totals) {
    const separator = key.indexOf("\n");
    entries.push({
      project_id: key.slice(0, separator),
      activity_date: key.slice(separator + 1),
      seconds: Math.round(seconds),
    });
  }
  return entries;
}
