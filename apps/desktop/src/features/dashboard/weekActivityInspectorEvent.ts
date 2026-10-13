import type { ActivitySegment } from "@drifty/domain";
import type {
  ActivityInspectorEvent,
  ActivityInspectorProjectOption,
} from "./WeekActivityInspector";
import type { WeekCalendarEvent } from "./weekCalendar";
import { summarizeDashboardActivityProject } from "./dashboardActivityProjects";

export function buildWeekActivityInspectorEvent(
  event: WeekCalendarEvent,
  segmentsById: ReadonlyMap<string, ActivitySegment>,
  projectBySegmentId: ReadonlyMap<string, string | null>,
  projectsById: ReadonlyMap<string, ActivityInspectorProjectOption>,
): ActivityInspectorEvent {
  const project = summarizeDashboardActivityProject(event.segmentIds, segmentsById, projectBySegmentId);
  const projectOption = project.projectId ? projectsById.get(project.projectId) ?? null : null;
  const sourceDurationSeconds = event.segmentIds.reduce((total, id) => total + (segmentsById.get(id)?.durationSeconds ?? 0), 0);
  const displayedDurationSeconds = event.activeDurationMinutes * 60;
  return {
    ...event,
    surface: "week",
    projectId: project.projectId,
    projectName: projectOption?.name ?? null,
    projectColor: projectOption?.color ?? null,
    projectAssignments: event.segmentIds.map((segmentId) => ({
      segmentId,
      projectId: projectBySegmentId.get(segmentId) ?? null,
    })),
    hasMixedProject: project.hasMixedProject || event.hasMixedProject === true,
    durationSeconds: displayedDurationSeconds,
    hasPartialSourceActivity: event.projectId !== undefined && sourceDurationSeconds > displayedDurationSeconds + 1,
  };
}
