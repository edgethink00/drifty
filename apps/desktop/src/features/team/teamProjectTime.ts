import {
  isRemoteDeviceSegment,
  logicalDayIsoDateForDate,
  type ActivitySegment,
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
): TeamProjectTotalsEntry[] {
  if (assignments.length === 0) return [];

  const durationBySegmentId = new Map<string, number>();
  const startBySegmentId = new Map<string, string>();
  for (const segment of segments) {
    if (isRemoteDeviceSegment(segment)) continue;
    durationBySegmentId.set(segment.id, segment.durationSeconds ?? 0);
    startBySegmentId.set(segment.id, segment.startedAt);
  }

  const totals = new Map<string, number>();
  for (const assignment of assignments) {
    if (assignment.stale) continue;
    const projectId = assignment.teamProjectId;
    if (!projectId) continue;
    const seconds = durationBySegmentId.get(assignment.segmentId) ?? 0;
    if (seconds <= 0) continue;
    const startedAt = startBySegmentId.get(assignment.segmentId);
    if (!startedAt) continue;
    const day = logicalDayIsoDateForDate(new Date(startedAt), startOfDayMinutes);
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
