import type { ActivitySegment, ProjectAssignmentRecord, ProjectWindowAssignmentRecord } from "@drifty/domain";
import { shiftIsoDate } from "@drifty/domain";
import { buildIsoDayList, isoDateFromTimestamp } from "../../lib/formatting";

/*
 * Figures for a project's detail. Everything is derived from the trend window
 * the Projects page already loads (project slices with their window and page
 * titles); nothing here fetches, stores or sends anything.
 */

/** A pause longer than this starts a new work session (the timeline cards' break rule). */
export const SESSION_GAP_SECONDS = 20 * 60;

export interface DetailSourceRef {
  readonly key: string;
  readonly label: string;
  readonly appName: string;
  readonly bundleId: string | null;
  readonly domain: string | null;
}

export interface DetailTitle {
  readonly key: string;
  readonly label: string;
  readonly source: DetailSourceRef;
  readonly seconds: number;
}

export interface DetailSource extends DetailSourceRef {
  readonly seconds: number;
  readonly titles: readonly DetailTitle[];
}

export interface DetailSession {
  readonly id: string;
  readonly day: string;
  readonly start: number;
  readonly end: number;
  readonly seconds: number;
  readonly sources: readonly DetailSource[];
  readonly titles: readonly DetailTitle[];
  readonly segments: readonly ActivitySegment[];
}

/** Minutes from local midnight, [start, end). */
export type MinuteInterval = readonly [number, number];

export interface DetailDay {
  readonly day: string;
  readonly seconds: number;
  readonly sessions: readonly DetailSession[];
  readonly projectIntervals: readonly MinuteInterval[];
  readonly otherIntervals: readonly MinuteInterval[];
}

export interface ProjectDetailModel {
  readonly totalSeconds: number;
  readonly previousSeconds: number;
  /** Everything recorded in the window, any project or none. */
  readonly trackedSeconds: number;
  readonly days: readonly DetailDay[];
  readonly activeDays: number;
  readonly sessions: readonly DetailSession[];
  readonly longestSession: DetailSession | null;
  readonly sources: readonly DetailSource[];
  readonly titles: readonly DetailTitle[];
  /** Busiest three-hour stretch of the clock, as [fromHour, toHour). */
  readonly peakHours: readonly [number, number] | null;
  /** Of this project's time in the window, the share inside peakHours (0–1). */
  readonly peakShare: number;
  /** Clock range that holds every recorded minute in the window, whole hours. */
  readonly clockRange: readonly [number, number];
}

export function sourceRefOf(segment: ActivitySegment): DetailSourceRef {
  const domain = segment.siteDomain?.trim() || null;
  const label = domain ?? segment.appName;
  return { key: label.trim().toLowerCase() || "unknown", label, appName: segment.appName, bundleId: segment.bundleId ?? null, domain };
}

/** The work a record names: a page title for a site, a window title otherwise, without the app's own suffix. */
export function titleOf(segment: ActivitySegment): string | null {
  const raw = (segment.siteDomain ? segment.siteTitle ?? segment.windowTitle : segment.windowTitle) ?? null;
  if (!raw) return null;
  let title = raw.trim();
  for (const separator of [" — ", " - ", " · "]) {
    const suffix = separator + segment.appName;
    if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
  }
  // A window named only after its app says nothing the icon doesn't.
  if (title.toLowerCase() === segment.appName.trim().toLowerCase()) return null;
  return title || null;
}

function startMs(segment: ActivitySegment): number {
  return new Date(segment.startedAt).getTime();
}

function endMs(segment: ActivitySegment): number {
  const started = startMs(segment);
  const ended = new Date(segment.endedAt).getTime();
  const byDuration = started + Math.max(0, segment.durationSeconds) * 1000;
  return Number.isFinite(ended) && ended > started ? Math.min(ended, byDuration) : byDuration;
}

function minuteInterval(segment: ActivitySegment): MinuteInterval {
  const start = new Date(startMs(segment));
  const startMinute = start.getHours() * 60 + start.getMinutes() + start.getSeconds() / 60;
  const minutes = Math.max(0.5, (endMs(segment) - startMs(segment)) / 60000);
  return [startMinute, Math.min(24 * 60, startMinute + minutes)];
}

function mergeIntervals(intervals: readonly MinuteInterval[]): MinuteInterval[] {
  const sorted = [...intervals].sort((left, right) => left[0] - right[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 2) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

const bySecondsThenLabel = (left: { readonly seconds: number; readonly label: string }, right: { readonly seconds: number; readonly label: string }) =>
  right.seconds - left.seconds || left.label.localeCompare(right.label);

/** Apps and sites ranked by time, each with the titles recorded in it. */
export function summarizeSources(segments: readonly ActivitySegment[]): DetailSource[] {
  const sources = new Map<string, { ref: DetailSourceRef; seconds: number; titles: Map<string, { label: string; seconds: number }> }>();
  for (const segment of segments) {
    const ref = sourceRefOf(segment);
    const entry = sources.get(ref.key) ?? { ref, seconds: 0, titles: new Map() };
    entry.seconds += segment.durationSeconds;
    const title = titleOf(segment);
    if (title) {
      const titleKey = title.toLowerCase();
      const current = entry.titles.get(titleKey) ?? { label: title, seconds: 0 };
      current.seconds += segment.durationSeconds;
      entry.titles.set(titleKey, current);
    }
    sources.set(ref.key, entry);
  }
  return [...sources.values()]
    .map((entry) => ({
      ...entry.ref,
      seconds: entry.seconds,
      titles: [...entry.titles.entries()]
        .map(([key, title]) => ({ key: entry.ref.key + "::" + key, label: title.label, source: entry.ref, seconds: title.seconds }))
        .sort(bySecondsThenLabel),
    }))
    .sort(bySecondsThenLabel);
}

/** Every recorded title across the sources, longest first. */
export function rankTitles(sources: readonly DetailSource[]): DetailTitle[] {
  return sources.flatMap((source) => source.titles).sort(bySecondsThenLabel);
}

export function buildSessions(segments: readonly ActivitySegment[]): DetailSession[] {
  const sorted = [...segments].sort((left, right) => startMs(left) - startMs(right));
  const groups: ActivitySegment[][] = [];
  let lastEnd = -Infinity;
  let lastDay = "";
  for (const segment of sorted) {
    const day = isoDateFromTimestamp(segment.startedAt) ?? "";
    const current = groups[groups.length - 1];
    if (current && day === lastDay && startMs(segment) - lastEnd <= SESSION_GAP_SECONDS * 1000) current.push(segment);
    else groups.push([segment]);
    lastEnd = Math.max(day === lastDay ? lastEnd : -Infinity, endMs(segment));
    lastDay = day;
  }
  return groups.map((group) => {
    const sources = summarizeSources(group);
    return {
      id: group[0]!.id,
      day: isoDateFromTimestamp(group[0]!.startedAt) ?? "",
      start: startMs(group[0]!),
      // A reduce, not a spread: a session can hold tens of thousands of records.
      end: group.reduce((latest, segment) => Math.max(latest, endMs(segment)), -Infinity),
      seconds: group.reduce((sum, segment) => sum + segment.durationSeconds, 0),
      sources,
      titles: rankTitles(sources),
      segments: group,
    };
  });
}

/**
 * How a session row names its work: the longest title, then the next ones.
 * Without any recorded title it names the apps and sites instead, so the row
 * never repeats one app's name.
 */
export function sessionHeadline(session: DetailSession): { readonly lead: string; readonly more: readonly string[] } {
  if (session.titles.length > 0) {
    return { lead: session.titles[0]!.label, more: session.titles.slice(1, 3).map((title) => title.label) };
  }
  return { lead: session.sources[0]?.label ?? "", more: session.sources.slice(1, 3).map((source) => source.label) };
}

function hourSecondsOf(segments: readonly ActivitySegment[]): number[] {
  const hourSeconds = Array.from({ length: 24 }, () => 0);
  for (const segment of segments) {
    let cursor = startMs(segment);
    const end = endMs(segment);
    while (cursor < end) {
      const at = new Date(cursor);
      const nextHour = new Date(at);
      nextHour.setMinutes(60, 0, 0);
      const stop = Math.min(end, nextHour.getTime());
      hourSeconds[at.getHours()]! += (stop - cursor) / 1000;
      cursor = stop;
    }
  }
  return hourSeconds;
}

export function buildProjectDetailModel(params: {
  readonly projectId: string;
  readonly windowSegments: readonly ActivitySegment[];
  readonly previousSegments: readonly ActivitySegment[];
  readonly projectBySegmentId: ReadonlyMap<string, string>;
  readonly startDay: string;
  readonly endDay: string;
}): ProjectDetailModel {
  const { projectId, projectBySegmentId } = params;
  const mine = params.windowSegments.filter((segment) => projectBySegmentId.get(segment.id) === projectId);
  const totalSeconds = mine.reduce((sum, segment) => sum + segment.durationSeconds, 0);
  const previousSeconds = params.previousSegments.reduce((sum, segment) => sum + (projectBySegmentId.get(segment.id) === projectId ? segment.durationSeconds : 0), 0);
  const trackedSeconds = params.windowSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
  const sessions = buildSessions(mine);

  const projectIntervals = new Map<string, MinuteInterval[]>();
  const otherIntervals = new Map<string, MinuteInterval[]>();
  let minMinute = Infinity;
  let maxMinute = -Infinity;
  for (const segment of params.windowSegments) {
    const day = isoDateFromTimestamp(segment.startedAt);
    if (!day) continue;
    const interval = minuteInterval(segment);
    minMinute = Math.min(minMinute, interval[0]);
    maxMinute = Math.max(maxMinute, interval[1]);
    const target = projectBySegmentId.get(segment.id) === projectId ? projectIntervals : otherIntervals;
    const list = target.get(day);
    if (list) list.push(interval);
    else target.set(day, [interval]);
  }
  const sessionsByDay = new Map<string, DetailSession[]>();
  for (const session of sessions) {
    const list = sessionsByDay.get(session.day);
    if (list) list.push(session);
    else sessionsByDay.set(session.day, [session]);
  }
  const days: DetailDay[] = buildIsoDayList(params.startDay, params.endDay).map((day) => {
    const daySessions = sessionsByDay.get(day) ?? [];
    return {
      day,
      seconds: daySessions.reduce((sum, session) => sum + session.seconds, 0),
      sessions: daySessions,
      projectIntervals: mergeIntervals(projectIntervals.get(day) ?? []),
      otherIntervals: mergeIntervals(otherIntervals.get(day) ?? []),
    };
  });

  const hourSeconds = hourSecondsOf(mine);
  let peakHours: [number, number] | null = null;
  let peakSeconds = 0;
  for (let hour = 0; hour <= 21; hour += 1) {
    const sum = hourSeconds[hour]! + hourSeconds[hour + 1]! + hourSeconds[hour + 2]!;
    if (sum > peakSeconds) {
      peakSeconds = sum;
      peakHours = [hour, hour + 3];
    }
  }

  const fromHour = Number.isFinite(minMinute) ? Math.floor(minMinute / 60) : 8;
  const toHour = Number.isFinite(maxMinute) ? Math.ceil(maxMinute / 60) : 20;
  const span = Math.max(8, toHour - fromHour);
  const clockRange: [number, number] = [Math.max(0, Math.min(fromHour, 24 - span)), Math.min(24, Math.max(fromHour, 0) + span)];
  const sources = summarizeSources(mine);

  return {
    totalSeconds,
    previousSeconds,
    trackedSeconds,
    days,
    activeDays: days.filter((day) => day.seconds > 0).length,
    sessions,
    longestSession: sessions.reduce<DetailSession | null>((best, session) => (!best || session.seconds > best.seconds ? session : best), null),
    sources,
    titles: rankTitles(sources),
    peakHours,
    peakShare: totalSeconds > 0 ? Math.min(1, peakSeconds / totalSeconds) : 0,
    clockRange,
  };
}

export interface PeriodTotal {
  readonly startDay: string;
  readonly endDay: string;
  readonly seconds: number;
}

/** This project's time in each of the last count windows of periodDays ending on endDay, oldest first. */
export function buildPeriodTotals(params: {
  readonly projectId: string;
  readonly segments: readonly ActivitySegment[];
  readonly projectBySegmentId: ReadonlyMap<string, string>;
  readonly endDay: string;
  readonly periodDays: number;
  readonly count: number;
}): PeriodTotal[] {
  const periods = Array.from({ length: params.count }, (_, index) => {
    const periodEnd = shiftIsoDate(params.endDay, -(params.count - 1 - index) * params.periodDays);
    return { startDay: shiftIsoDate(periodEnd, -(params.periodDays - 1)), endDay: periodEnd, seconds: 0 };
  });
  for (const segment of params.segments) {
    if (params.projectBySegmentId.get(segment.id) !== params.projectId) continue;
    const day = isoDateFromTimestamp(segment.startedAt);
    if (!day) continue;
    const period = periods.find((item) => day >= item.startDay && day <= item.endDay);
    if (period) period.seconds += segment.durationSeconds;
  }
  return periods;
}

/**
 * The recent-trend average: from the first period with any record up to the one
 * before the latest, so the weeks before a project began don't pull it down
 * while a later empty week still counts. Null without an earlier period.
 */
export function averageBeforeLatest(periods: readonly PeriodTotal[]): number | null {
  const firstActive = periods.findIndex((period) => period.seconds > 0);
  const earlier = firstActive >= 0 ? periods.slice(firstActive, -1) : [];
  if (earlier.length === 0) return null;
  return earlier.reduce((sum, period) => sum + period.seconds, 0) / earlier.length;
}

/** Where a project's assignments came from: the records behind the shown slices. */
export interface ProjectAssignmentSources {
  readonly assignments: readonly ProjectAssignmentRecord[];
  readonly windowAssignments: readonly ProjectWindowAssignmentRecord[];
  /** Project slice id -> original record id. */
  readonly sourceSegmentIdBySliceId: ReadonlyMap<string, string>;
}

export interface SessionEvidence {
  /** Seconds the user assigned to the project by hand. */
  readonly manualSeconds: number;
  /** Seconds AI matched. */
  readonly aiSeconds: number;
  /** Time-weighted AI confidence (0–1), when the matches carry one. */
  readonly confidence: number | null;
  /** The AI's reason behind most of the session's matched time. */
  readonly reason: string | null;
}

/**
 * Why a session's time belongs to the project: a manual choice on its records,
 * or the AI window matches (with their confidence and reason) that cover it.
 */
export function sessionEvidence(segments: readonly ActivitySegment[], sources: ProjectAssignmentSources): SessionEvidence {
  const ids = new Set(segments.map((segment) => sources.sourceSegmentIdBySliceId.get(segment.id) ?? segment.id));
  const manual = new Map<string, ProjectAssignmentRecord>();
  const legacy = new Map<string, ProjectAssignmentRecord>();
  for (const record of sources.assignments) {
    if (record.stale || !ids.has(record.segmentId)) continue;
    (record.source === "manual" ? manual : legacy).set(record.segmentId, record);
  }
  const windowsBySource = new Map<string, ProjectWindowAssignmentRecord[]>();
  for (const window of sources.windowAssignments) {
    if (window.stale) continue;
    for (const overlap of window.segmentOverlaps) {
      if (!ids.has(overlap.segmentId)) continue;
      const list = windowsBySource.get(overlap.segmentId);
      if (list) list.push(window);
      else windowsBySource.set(overlap.segmentId, [window]);
    }
  }
  let manualSeconds = 0;
  let aiSeconds = 0;
  let confidenceSeconds = 0;
  let confidenceSum = 0;
  const reasonSeconds = new Map<string, number>();
  for (const segment of segments) {
    const sourceId = sources.sourceSegmentIdBySliceId.get(segment.id) ?? segment.id;
    const seconds = segment.durationSeconds;
    if (manual.has(sourceId)) {
      manualSeconds += seconds;
      continue;
    }
    aiSeconds += seconds;
    const at = startMs(segment);
    const window = windowsBySource.get(sourceId)?.find((item) => at >= Date.parse(item.windowStartedAt) && at < Date.parse(item.windowEndedAt));
    const record = window ?? legacy.get(sourceId);
    if (!record) continue;
    if (typeof record.confidence === "number") {
      confidenceSum += record.confidence * seconds;
      confidenceSeconds += seconds;
    }
    const reason = record.reason?.trim();
    if (reason) reasonSeconds.set(reason, (reasonSeconds.get(reason) ?? 0) + seconds);
  }
  const reason = [...reasonSeconds.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  return {
    manualSeconds,
    aiSeconds,
    confidence: confidenceSeconds > 0 ? confidenceSum / confidenceSeconds : null,
    reason,
  };
}
