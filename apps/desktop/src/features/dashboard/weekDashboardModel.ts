import { classifyActivityDetailed } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { buildIsoDayList, filterSegmentsForRange, getLogicalDayRange } from "../../lib/formatting";
import { buildWeekCalendarEvents, buildWeekDayRows } from "./weekCalendar";
import type { WeekCalendarEvent, WeekDayRow, WeekSegmentClassification } from "./weekCalendar";

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

export type WeekDashboardDayModelCacheSettings = {
  readonly includeAiClassifications: boolean;
  readonly startOfDayMinutes: number;
};

type WeekDashboardDayModelCacheEntry = {
  readonly model: WeekDashboardDayModel;
  readonly segmentSignature: string;
};

export class WeekDashboardDayModelCache {
  private readonly modelsByDay = new Map<string, WeekDashboardDayModelCacheEntry>();

  get(day: string, segmentSignature?: string): WeekDashboardDayModel | null {
    const entry = this.modelsByDay.get(day);
    if (!entry) return null;
    if (segmentSignature !== undefined && entry.segmentSignature !== segmentSignature) {
      return null;
    }
    return entry.model;
  }

  set(model: WeekDashboardDayModel, segmentSignature: string): void {
    this.modelsByDay.set(model.day, { model, segmentSignature });
  }

  clear(): void {
    this.modelsByDay.clear();
  }

  get size(): number {
    return this.modelsByDay.size;
  }
}

export function buildWeekDashboardDayModel(input: WeekDashboardDayModelInput): WeekDashboardDayModel {
  const daySegments = filterSegmentsForLogicalDay(input.segments, input.day, input.startOfDayMinutes);
  return buildWeekDashboardDayModelForSegments(input.day, daySegments, input.classificationOptions, input.startOfDayMinutes);
}

function buildWeekDashboardDayModelForSegments(
  day: string,
  daySegments: ActivitySegment[],
  classificationOptions: ClassificationOptions | undefined,
  startOfDayMinutes: number,
): WeekDashboardDayModel {
  const classificationBySegmentId = buildClassificationBySegmentId(daySegments, classificationOptions);
  const rows = buildWeekDayRows(daySegments, day, day, classificationOptions, startOfDayMinutes, classificationBySegmentId);
  const calendarEventsByDay = buildWeekCalendarEvents(
    daySegments,
    day,
    day,
    WEEK_DASHBOARD_CALENDAR_START_HOUR,
    WEEK_DASHBOARD_CALENDAR_END_HOUR,
    classificationOptions,
    startOfDayMinutes,
    classificationBySegmentId,
  );

  return {
    day,
    row: rows[0] ?? buildEmptyWeekDayRow(day, startOfDayMinutes),
    calendarEvents: calendarEventsByDay.get(day) ?? [],
  };
}

export function syncWeekDashboardDayModelCacheSettings(
  cache: WeekDashboardDayModelCache,
  previousSettings: WeekDashboardDayModelCacheSettings | null,
  nextSettings: WeekDashboardDayModelCacheSettings,
): WeekDashboardDayModelCacheSettings {
  if (
    previousSettings
    && previousSettings.includeAiClassifications === nextSettings.includeAiClassifications
    && previousSettings.startOfDayMinutes === nextSettings.startOfDayMinutes
  ) {
    return previousSettings;
  }

  if (previousSettings) cache.clear();
  return nextSettings;
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
      const daySegments = filterSegmentsForLogicalDay(input.segments, day, input.startOfDayMinutes);
      const segmentSignature = buildWeekDashboardSegmentSignature(daySegments);
      const cachedModel = input.cache.get(day, segmentSignature);
      if (cachedModel) {
        cacheStats.closedDayHits += 1;
        appendDayModel(cachedModel, rows, calendarEvents);
        continue;
      }

      const computedModel = buildWeekDashboardDayModelForSegments(day, daySegments, input.classificationOptions, input.startOfDayMinutes);
      input.cache.set(computedModel, segmentSignature);
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
    const daySegments = filterSegmentsForLogicalDay(input.segments, day, input.startOfDayMinutes);
    const segmentSignature = buildWeekDashboardSegmentSignature(daySegments);
    if (input.cache.get(day, segmentSignature)) continue;
    input.cache.set(buildWeekDashboardDayModelForSegments(day, daySegments, input.classificationOptions, input.startOfDayMinutes), segmentSignature);
    warmedDays += 1;
  }

  return warmedDays;
}

export function emptyWeekDashboardModel(): WeekDashboardModel {
  const emptyStats: WeekDashboardCacheStats = {
    closedDayHits: 0,
    closedDaysComputed: 0,
    futureDaysSkipped: 0,
    liveDaysComputed: 0,
  };
  return { rows: [], calendarEvents: new Map(), cacheStats: emptyStats };
}

function appendDayModel(model: WeekDashboardDayModel, rows: WeekDayRow[], calendarEvents: Map<string, WeekCalendarEvent[]>): void {
  rows.push(model.row);
  calendarEvents.set(model.day, model.calendarEvents);
}

function buildClassificationBySegmentId(
  segments: readonly ActivitySegment[],
  classificationOptions?: ClassificationOptions,
): ReadonlyMap<string, WeekSegmentClassification> {
  const classificationBySegmentId = new Map<string, WeekSegmentClassification>();
  for (const segment of segments) {
    classificationBySegmentId.set(segment.id, classifyActivityDetailed(segment, classificationOptions));
  }
  return classificationBySegmentId;
}

function filterSegmentsForLogicalDay(segments: ActivitySegment[], day: string, startOfDayMinutes: number): ActivitySegment[] {
  const range = getLogicalDayRange(day, day, startOfDayMinutes);
  return filterSegmentsForRange(segments, range.start, range.end);
}

function buildWeekDashboardSegmentSignature(segments: readonly ActivitySegment[]): string {
  return segments.map(segmentSignature).join("\u001e");
}

function segmentSignature(segment: ActivitySegment): string {
  const classification = segment.classification;
  return [
    segment.id,
    segment.deviceId,
    segment.startedAt,
    segment.endedAt,
    segment.durationSeconds,
    segment.appName,
    segment.bundleId,
    segment.windowTitle,
    segment.browserName,
    segment.siteDomain,
    segment.siteTitle,
    segment.siteUrl,
    segment.youtubeVideoId,
    segment.youtubePlaylistId,
    segment.youtubeIsShorts,
    segment.youtubeCategory,
    segment.youtubeChannelId,
    segment.youtubeChannelName,
    segment.youtubeTitle,
    segment.youtubeDurationSeconds,
    segment.youtubeViewCount,
    segment.youtubeIsLive,
    segment.youtubeIsUnlisted,
    segment.youtubePublishDate,
    segment.youtubeUploadDate,
    classification?.category,
    classification?.productivity,
    classification?.source,
    classification?.confidence,
    classification?.reason,
    classification?.model,
    classification?.promptVersion,
    classification?.taxonomyVersion,
    classification?.inputFingerprint,
    classification?.classifiedAt,
    classification?.aiResult,
    classification?.stale,
    classification?.reusedAiResult,
    classification?.classificationRuleId,
  ].map(signaturePart).join("\u001f");
}

function signaturePart(value: string | number | boolean | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
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
