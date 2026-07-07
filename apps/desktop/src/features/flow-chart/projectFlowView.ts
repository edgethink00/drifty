import { buildContextualProjectBySegmentId, type ActivitySegment, type ClassificationOptions, type Project, type ProjectAssignmentRecord } from "@drifty/domain";

/**
 * View helpers for the flow chart's "project" color mode. Kept isolated from the
 * live FlowChart components so the color mapping + legend are unit-testable
 * before the mode is wired into the grid. Unassigned time renders gray (the
 * established convention: Timing/ActivityWatch), never hidden.
 */
export const NO_PROJECT_COLOR = "#9ca3af";
export const NO_PROJECT_LABEL = "No project";

/** segmentId → color: the assigned project's color, or gray for null/unknown. */
export function projectColorBySegment(
  assignments: readonly ProjectAssignmentRecord[],
  projectColors: ReadonlyMap<string, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const assignment of assignments) {
    const color = assignment.projectId ? projectColors.get(assignment.projectId) ?? NO_PROJECT_COLOR : NO_PROJECT_COLOR;
    result.set(assignment.segmentId, color);
  }
  return result;
}

export interface ProjectLegendEntry {
  readonly projectId: string | null;
  readonly name: string;
  readonly color: string;
}

/** Legend for project mode: active projects that actually appear, then gray "No project". */
export function projectFlowLegend(
  projects: readonly Project[],
  assignments: readonly ProjectAssignmentRecord[],
): ProjectLegendEntry[] {
  const assignedIds = new Set(assignments.filter((a) => a.projectId).map((a) => a.projectId as string));
  const entries: ProjectLegendEntry[] = projects
    .filter((project) => assignedIds.has(project.id))
    .map((project) => ({ projectId: project.id, name: project.name, color: project.color }));
  const hasUnassigned = assignments.some((a) => !a.projectId);
  if (hasUnassigned || entries.length === 0) {
    entries.push({ projectId: null, name: NO_PROJECT_LABEL, color: NO_PROJECT_COLOR });
  }
  return entries;
}

export function projectColorMap(projects: readonly Project[]): Map<string, string> {
  return new Map(projects.map((project) => [project.id, project.color]));
}

/**
 * Per-segment project colors for the flow chart, with contextual gap-filling:
 * unassigned segments dominated by a project in their surrounding window inherit
 * that project's color (see buildContextualProjectBySegmentId). Segments that
 * stay unassigned are omitted so the grid falls back to gray.
 */
export function contextualProjectColorBySegment(
  segments: ActivitySegment[],
  assignments: readonly ProjectAssignmentRecord[],
  projectColors: ReadonlyMap<string, string>,
  options?: ClassificationOptions,
): Map<string, string> {
  const assignmentBySegmentId = new Map<string, string | null>();
  for (const assignment of assignments) assignmentBySegmentId.set(assignment.segmentId, assignment.projectId ?? null);
  const effective = buildContextualProjectBySegmentId(segments, assignmentBySegmentId, options);
  const result = new Map<string, string>();
  for (const [segmentId, resolution] of effective) {
    if (!resolution.projectId) continue;
    result.set(segmentId, projectColors.get(resolution.projectId) ?? NO_PROJECT_COLOR);
  }
  return result;
}
