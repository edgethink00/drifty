import { buildPersonalProjectSliceProjection, type ActivitySegment, type ClassificationOptions, type ProjectAssignmentRecord, type ProjectWindowAssignmentRecord } from "@drifty/domain";
import { buildIsoDayList } from "../../lib/formatting";
import { NO_PROJECT_COLOR, type ProjectLegendEntry } from "../flow-chart/projectFlowView";
import type { CompactRingEntry } from "./CompactRingChart";
import type { ActivityInspectorProjectOption } from "./WeekActivityInspector";
import { assignWeekCalendarEventLanes, buildWeekCalendarEvents, splitSegmentIntoDayOverlaps, type WeekCalendarEvent } from "./weekCalendar";
import { buildWeekCalendarEventLayout } from "./weekCalendarEventLayout";
import { WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT, weekDashboardAxisScalePercentToHourHeight } from "./weekDashboardAxisScale";

export const WEEK_NO_PROJECT_KEY = "__no_project__";

export type WeekProjectSlice = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly seconds: number;
};

type WeekProjectViewInput = {
  readonly segments: readonly ActivitySegment[];
  readonly assignments: readonly ProjectAssignmentRecord[];
  readonly windowAssignments: readonly ProjectWindowAssignmentRecord[];
  readonly projects: readonly ActivityInspectorProjectOption[];
  readonly classificationOptions: ClassificationOptions;
  readonly startDay: string;
  readonly endDay: string;
  readonly startOfDayMinutes: number;
  readonly noProjectLabel: string;
  readonly unavailableProjectLabel: string;
  readonly calendarHourHeightPx?: number;
};

/** Calendar, donut, bars and hovers share the persisted-window time allocation.
 * Calendar actions still target full source records, never virtual slice ids. */
export function buildWeekProjectView(input: WeekProjectViewInput) {
  const projection = buildPersonalProjectSliceProjection(input.segments, input.windowAssignments, input.assignments);
  const projectsById = new Map(input.projects.flatMap(project => project.id ? [[project.id, project] as const] : []));
  const days = buildIsoDayList(input.startDay, input.endDay);
  const totals = new Map<string, number>();
  const dayTotals = new Map(days.map(day => [day, new Map<string, number>()]));
  const sourceId = (id: string) => projection.sourceSegmentIdBySliceId.get(id) ?? id;
  const keyForSlice = (id: string) => projection.projectBySegmentId.get(id) ?? WEEK_NO_PROJECT_KEY;
  const projectsBySource = new Map<string, Set<string>>();
  for (const segment of projection.segments) {
    const id = sourceId(segment.id);
    const keys = projectsBySource.get(id) ?? new Set<string>();
    keys.add(keyForSlice(segment.id));
    projectsBySource.set(id, keys);
  }

  for (const segment of projection.segments) {
    const key = keyForSlice(segment.id);
    for (const overlap of splitSegmentIntoDayOverlaps(segment, input.startDay, input.endDay, input.startOfDayMinutes, { sampledTime: true })) {
      const bucket = dayTotals.get(overlap.day)!;
      bucket.set(key, (bucket.get(key) ?? 0) + overlap.durationSeconds);
      totals.set(key, (totals.get(key) ?? 0) + overlap.durationSeconds);
    }
  }
  // A stable week-wide order; No project stays at the residual end.
  const keys = [...totals.keys()].sort((a, b) => Number(a === WEEK_NO_PROJECT_KEY) - Number(b === WEEK_NO_PROJECT_KEY)
    || (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a.localeCompare(b));
  const slice = (key: string, seconds: number): WeekProjectSlice => ({
    key,
    seconds,
    label: key === WEEK_NO_PROJECT_KEY ? input.noProjectLabel : projectsById.get(key)?.name ?? input.unavailableProjectLabel,
    color: projectsById.get(key)?.color ?? NO_PROJECT_COLOR,
  });
  const totalSeconds = [...totals.values()].reduce((sum, value) => sum + value, 0);
  const ringEntries: CompactRingEntry[] = keys.map(key => {
    const item = slice(key, totals.get(key)!);
    return { ...item, totalSeconds: item.seconds, ratio: totalSeconds > 0 ? item.seconds / totalSeconds : 0, matchesBlock: () => false };
  });
  const legend: ProjectLegendEntry[] = ringEntries.length === 0 ? [{ projectId: null, name: input.noProjectLabel, color: NO_PROJECT_COLOR }] : ringEntries.map(entry => ({
    projectId: entry.key === WEEK_NO_PROJECT_KEY ? null : entry.key,
    name: entry.label,
    color: entry.color,
  }));
  const slicesByDay = new Map(days.map(day => [day, keys.flatMap(key => {
    const seconds = dayTotals.get(day)?.get(key) ?? 0;
    return seconds > 0 ? [slice(key, seconds)] : [];
  })]));

  const calendarEvents = new Map<string, WeekCalendarEvent[]>(days.map(day => [day, []]));
  let run: ActivitySegment[] = [];
  let runKey = "";
  let runIndex = 0;
  const flush = () => {
    if (run.length === 0) return;
    const meta = slice(runKey, 0);
    const runDays = run.flatMap(segment => splitSegmentIntoDayOverlaps(segment, input.startDay, input.endDay, input.startOfDayMinutes, { sampledTime: true }).map(overlap => overlap.day)).sort();
    if (runDays.length === 0) { run = []; return; }
    const events = buildWeekCalendarEvents(run, runDays[0], runDays[runDays.length - 1], 0, 24, input.classificationOptions, input.startOfDayMinutes, undefined, { sampledTime: true });
    for (const [day, entries] of events) {
      for (const event of entries) {
        const segmentIds = [...new Set(event.segmentIds.map(sourceId))];
        calendarEvents.get(day)!.push({
          ...event,
          id: `project:${runIndex}:${event.id}`,
          segmentIds,
          detailSummary: meta.label,
          detailTitle: `${event.startLabel}–${event.endLabel} · ${meta.label}\n${segmentIds.length} captured record${segmentIds.length === 1 ? "" : "s"}`,
          sessionCount: segmentIds.length,
          hasMixedProject: segmentIds.some(id => (projectsBySource.get(id)?.size ?? 0) > 1),
          identities: event.identities.map(identity => ({ ...identity, sourceSegmentIds: [...new Set((identity.sourceSegmentIds ?? []).map(sourceId))] })),
          projectId: runKey === WEEK_NO_PROJECT_KEY ? null : runKey,
          projectName: meta.label,
          projectColor: meta.color,
        });
      }
    }
    run = [];
    runIndex += 1;
  };
  for (const segment of [...projection.segments].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))) {
    const key = keyForSlice(segment.id);
    if (key !== runKey) flush();
    runKey = key;
    run.push(segment);
  }
  flush();
  for (const events of calendarEvents.values()) {
    events.sort((a, b) => a.topMinutes - b.topMinutes || b.durationMinutes - a.durationMinutes);
    // Three-minute decisions use the existing minimum card height. Assign lanes
    // using the rendered height so adjacent projects remain visible/clickable.
    const hourHeight = input.calendarHourHeightPx ?? weekDashboardAxisScalePercentToHourHeight(WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT);
    assignWeekCalendarEventLanes(events, event => Math.max(event.durationMinutes,
      (buildWeekCalendarEventLayout(event, hourHeight).eventHeight + 1) / hourHeight * 60));
  }
  return { ...projection, calendarEvents, slicesByDay, ringEntries, legend, totalSeconds,
    centerPercent: totalSeconds > 0 ? Math.round((ringEntries[0]?.totalSeconds ?? 0) / totalSeconds * 100) : 0 };
}
