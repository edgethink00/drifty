import { buildPersonalProjectSliceProjection, sampledActivitySecondsWithinInterval, type ActivitySegment, type ProjectAssignmentRecord, type ProjectWindowAssignmentRecord } from "@drifty/domain";
import { buildIsoDayList } from "../../lib/formatting";
import { NO_PROJECT_COLOR, type ProjectLegendEntry } from "../flow-chart/projectFlowView";
import type { CompactRingEntry } from "./CompactRingChart";
import type { ActivityInspectorProjectOption } from "./WeekActivityInspector";
import { splitSegmentIntoDayOverlaps, type WeekCalendarEvent } from "./weekCalendar";
import { buildLogicalDayDrawingBuckets } from "./logicalDayDrawingBuckets";

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
  readonly calendarEvents: ReadonlyMap<string, readonly WeekCalendarEvent[]>;
  readonly startDay: string;
  readonly endDay: string;
  readonly startOfDayMinutes: number;
  readonly noProjectLabel: string;
  readonly unavailableProjectLabel: string;
};

/** Project summaries keep exact persisted-window shares. The calendar only
 * decorates the existing activity blocks with their dominant project color. */
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

  const slicesBySource = new Map<string, ActivitySegment[]>();
  for (const segment of projection.segments) {
    const id = sourceId(segment.id);
    const slices = slicesBySource.get(id) ?? [];
    slices.push(segment);
    slicesBySource.set(id, slices);
  }
  const calendarEvents = new Map<string, WeekCalendarEvent[]>();
  for (const [day, events] of input.calendarEvents) {
    // Use the same fixed clock axis as the calendar, including logical-day
    // boundaries and both occurrences of a folded DST hour.
    const minutes = buildLogicalDayDrawingBuckets(day, 1, input.startOfDayMinutes);
    calendarEvents.set(day, events.map(event => {
      const intervals = minutes.slice(event.topMinutes, event.topMinutes + event.durationMinutes)
        .flatMap(minute => minute.intervals);
      const weights = new Map<string, number>();
      for (const id of event.segmentIds) {
        for (const segment of slicesBySource.get(id) ?? []) {
          const seconds = intervals.reduce((sum, interval) => sum
            + sampledActivitySecondsWithinInterval(segment, interval.start, interval.end), 0);
          if (!(seconds > 0)) continue;
          const key = keyForSlice(segment.id);
          weights.set(key, (weights.get(key) ?? 0) + seconds);
        }
      }
      // Resolve equal shares by key so assignment load order cannot change a
      // block's color. No project competes with the same weight as any project.
      const key = [...weights].sort(([a, aSeconds], [b, bSeconds]) => bSeconds - aSeconds || a.localeCompare(b))[0]?.[0] ?? WEEK_NO_PROJECT_KEY;
      const meta = slice(key, 0);
      return {
        ...event,
        projectId: key === WEEK_NO_PROJECT_KEY ? null : key,
        projectName: meta.label,
        projectColor: meta.color,
        hasMixedProject: weights.size > 1 || event.segmentIds.some(id => (projectsBySource.get(id)?.size ?? 0) > 1),
      };
    }));
  }
  return { ...projection, calendarEvents, slicesByDay, ringEntries, legend, totalSeconds,
    centerPercent: totalSeconds > 0 ? Math.round((ringEntries[0]?.totalSeconds ?? 0) / totalSeconds * 100) : 0 };
}
