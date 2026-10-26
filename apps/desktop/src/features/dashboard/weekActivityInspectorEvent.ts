import type { ActivitySegment } from "@drifty/domain";
import type {
  ActivityInspectorEvent,
  ActivityInspectorProjectOption,
} from "./WeekActivityInspector";
import type { WeekCalendarEvent } from "./weekCalendar";
import { summarizeDashboardActivityProject } from "./dashboardActivityProjects";
import { activityEvidenceSelection, activityEvidenceSelectionForSourceRanges } from "../screen-context/activityEvidenceSelection";

export function buildWeekActivityInspectorEvent(
  event: WeekCalendarEvent,
  segmentsById: ReadonlyMap<string, ActivitySegment>,
  projectBySegmentId: ReadonlyMap<string, string | null>,
  projectsById: ReadonlyMap<string, ActivityInspectorProjectOption>,
  drawing?: { readonly day: string; readonly boundaryMinutes: number },
): ActivityInspectorEvent {
  const project = summarizeDashboardActivityProject(event.segmentIds, segmentsById, projectBySegmentId);
  const projectOption = project.projectId ? projectsById.get(project.projectId) ?? null : null;
  const sourceDurationSeconds = event.segmentIds.reduce((total, id) => total + (segmentsById.get(id)?.durationSeconds ?? 0), 0);
  const displayedDurationSeconds = event.activeDurationMinutes * 60;
  const selectedSegments = event.segmentIds.flatMap(id => { const row = segmentsById.get(id); return row ? [row] : []; });
  return {
    ...event,
    screenEvidenceSelection: !drawing ? null : event.sourceTimeRanges !== undefined
      ? activityEvidenceSelectionForSourceRanges(selectedSegments, event.sourceTimeRanges)
      : activityEvidenceSelection(
      selectedSegments,
      drawing.day,event.topMinutes,event.topMinutes+event.durationMinutes,drawing.boundaryMinutes,
    ),
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
