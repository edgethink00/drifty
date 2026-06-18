import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { buildIsoDayList, filterSegmentsForRange, getLogicalDayRange } from "../../lib/formatting";
import { buildWeekCalendarEvents, buildWeekDayRows } from "./weekCalendar";
import type { WeekCalendarEvent, WeekDayRow } from "./weekCalendar";

export const WEEK_DASHBOARD_CALENDAR_START_HOUR = 0;
export const WEEK_DASHBOARD_CALENDAR_END_HOUR = 24;

export type WeekDashboardDayModel = {
  readonly day: string;
  readonly row: WeekDayRow;
  readonly calendarEvents: WeekCalendarEvent[];
};

export type WeekDashboardCacheStats = {
  readonly closedDayHits: number;
  readonly closedDaysComputed: number;
  readonly liveDaysComputed: number;
  readonly futureDaysSkipped: number;
};

export type WeekDashboardModel = {
  readonly rows: WeekDayRow[];
  readonly calendarEvents: Map<string, WeekCalendarEvent[]>;
  readonly cacheStats: WeekDashboardCacheStats;
};

type WeekDashboardDayModelInput = {
  readonly day: string;
  readonly segments: ActivitySegment[];
  readonly classificationOptions?: ClassificationOptions;
  readonly startOfDayMinutes: number;
};

type WeekDashboardModelInput = {
  readonly cache: WeekDashboardDayModelCache;
  readonly classificationOptions?: ClassificationOptions;
  readonly endDay: string;
  readonly segments: ActivitySegment[];
  readonly startDay: string;
  readonly startOfDayMinutes: number;
  readonly todayDay: string;
};

export class WeekDashboardDayModelCache {
  private readonly modelsByDay = new Map<string, WeekDashboardDayModel>();

  get(day: string): WeekDashboardDayModel | null {
    return this.modelsByDay.get(day) ?? null;
  }

  set(model: WeekDashboardDayModel): void {
    this.modelsByDay.set(model.day, model);
  }

  clear(): void {
    this.modelsByDay.clear();
  }

  get size(): number {
    return this.modelsByDay.size;
  }
}

export function buildWeekDashboardDayModel(input: WeekDashboardDayModelInput): WeekDashboardDayModel {
  const range = getLogicalDayRange(input.day, input.day, input.startOfDayMinutes);
  const daySegments = filterSegmentsForRange(input.segments, range.start, range.end);
  const rows = buildWeekDayRows(daySegments, input.day, input.day, input.classificationOptions, input.startOfDayMinutes);
  const calendarEventsByDay = buildWeekCalendarEvents(
    daySegments,
    input.day,
    input.day,
    WEEK_DASHBOARD_CALENDAR_START_HOUR,
    WEEK_DASHBOARD_CALENDAR_END_HOUR,
    input.classificationOptions,
    input.startOfDayMinutes,
  );

  return {
    day: input.day,
    row: rows[0] ?? buildEmptyWeekDayRow(input.day, input.startOfDayMinutes),
    calendarEvents: calendarEventsByDay.get(input.day) ?? [],
  };
}

export function buildWeekDashboardModel(input: WeekDashboardModelInput): WeekDashboardModel {
  const rows: WeekDayRow[] = [];
  const calendarEvents = new Map<string, WeekCalendarEvent[]>();
  const cacheStats = {
    closedDayHits: 0,
    closedDaysComputed: 0,
    liveDaysComputed: 0,
    futureDaysSkipped: 0,
  };

  for (const day of buildIsoDayList(input.startDay, input.endDay)) {
    if (day < input.todayDay) {
      const cachedModel = input.cache.get(day);
      if (cachedModel) {
        cacheStats.closedDayHits += 1;
        appendDayModel(cachedModel, rows, calendarEvents);
        continue;
      }

      const computedModel = buildWeekDashboardDayModel({ ...input, day });
      input.cache.set(computedModel);
      cacheStats.closedDaysComputed += 1;
      appendDayModel(computedModel, rows, calendarEvents);
      continue;
    }

    if (day === input.todayDay) {
      const liveModel = buildWeekDashboardDayModel({ ...input, day });
      cacheStats.liveDaysComputed += 1;
      appendDayModel(liveModel, rows, calendarEvents);
      continue;
    }

    const emptyModel = buildEmptyWeekDashboardDayModel(day, input.startOfDayMinutes);
    cacheStats.futureDaysSkipped += 1;
    appendDayModel(emptyModel, rows, calendarEvents);
  }

  return { rows, calendarEvents, cacheStats };
}

export function prewarmClosedWeekDashboardDays(input: WeekDashboardModelInput): number {
  let warmedDays = 0;

  for (const day of buildIsoDayList(input.startDay, input.endDay)) {
    if (day >= input.todayDay) continue;
    if (input.cache.get(day)) continue;
    input.cache.set(buildWeekDashboardDayModel({ ...input, day }));
    warmedDays += 1;
  }

  return warmedDays;
}

function appendDayModel(model: WeekDashboardDayModel, rows: WeekDayRow[], calendarEvents: Map<string, WeekCalendarEvent[]>): void {
  rows.push(model.row);
  calendarEvents.set(model.day, model.calendarEvents);
}

function buildEmptyWeekDashboardDayModel(day: string, startOfDayMinutes: number): WeekDashboardDayModel {
  return {
    day,
    row: buildEmptyWeekDayRow(day, startOfDayMinutes),
    calendarEvents: [],
  };
}

function buildEmptyWeekDayRow(day: string, startOfDayMinutes: number): WeekDayRow {
  const rows = buildWeekDayRows([], day, day, undefined, startOfDayMinutes);
  const row = rows[0];
  if (row) return row;

  const date = new Date(`${day}T12:00:00`);
  return {
    day,
    dayName: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date),
    dayNumber: new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(date),
    totalSeconds: 0,
    focusSeconds: 0,
    focusScore: 0,
    slices: [],
  };
}
