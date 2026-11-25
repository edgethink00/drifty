import {
  activitySecondsWithinInterval,
  activityTimeBounds,
  aggregateDeviceElapsedTime,
  classifyActivity,
  isBrowserHistoryImportSegment,
  isExcludedSegment,
  isFailedForegroundCaptureSegment,
  logicalDayEndExclusiveMs,
  logicalDayIsoDateForDate,
  logicalDayStartMs,
  shiftIsoDate,
  type ActivitySegment,
  type ClassificationOptions,
} from "@drifty/domain";

/**
 * One finished logical day, reduced to the few numbers achievements read.
 * These stay on this computer; achievements never need the records themselves
 * once a day has been summarised.
 */
export type AchievementDayFacts = {
  readonly day: string;
  readonly trackedSeconds: number;
  readonly focusSeconds: number;
  readonly driftSeconds: number;
  /** Longest stretch of focus in which no other activity and no gap over five minutes came between. */
  readonly longestFocusRunSeconds: number;
  /** Focus between 05:00 and 07:00 on the clock. */
  readonly earlyFocusSeconds: number;
  /** Focus between 02:00 and 05:00 on the clock. */
  readonly lateFocusSeconds: number;
};

/** Same gap the Companion's focus records use before a stretch counts as broken. */
export const ACHIEVEMENT_FOCUS_RUN_MAX_GAP_MS = 5 * 60 * 1000;
export const ACHIEVEMENT_EARLY_WINDOW = { fromHour: 5, toHour: 7 } as const;
export const ACHIEVEMENT_LATE_WINDOW = { fromHour: 2, toHour: 5 } as const;

type MutableFacts = {
  trackedSeconds: number;
  focusSeconds: number;
  driftSeconds: number;
  longestFocusRunSeconds: number;
  earlyFocusSeconds: number;
  lateFocusSeconds: number;
};

type ClassifiedSegment = {
  readonly segment: ActivitySegment;
  readonly start: number;
  readonly end: number;
  readonly productivity: "focus" | "neutral" | "drift";
};

/**
 * Summarise every logical day from startDay to endDay that has recorded time.
 * Excluded apps, failed captures and estimated browser-history imports do not
 * count, so an achievement always rests on activity this computer recorded.
 */
export function buildAchievementDayFacts(
  segments: readonly ActivitySegment[],
  {
    startDay,
    endDay,
    startOfDayMinutes = 0,
    classificationOptions,
  }: {
    readonly startDay: string;
    readonly endDay: string;
    readonly startOfDayMinutes?: number;
    readonly classificationOptions?: ClassificationOptions;
  },
): AchievementDayFacts[] {
  if (startDay > endDay) return [];
  const rangeStart = logicalDayStartMs(startDay, startOfDayMinutes);
  const rangeEnd = logicalDayEndExclusiveMs(endDay, startOfDayMinutes);
  const counted = segments.filter((segment) => !isExcludedSegment(segment)
    && !isFailedForegroundCaptureSegment(segment)
    && !isBrowserHistoryImportSegment(segment));
  const options: ClassificationOptions = { ...classificationOptions, fallbackCandidates: counted };
  const classified: ClassifiedSegment[] = [];
  for (const segment of aggregateDeviceElapsedTime(counted)) {
    const { start, end } = activityTimeBounds(segment);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    if (end < rangeStart || start >= rangeEnd) continue;
    classified.push({ segment, start, end, productivity: classifyActivity(segment, options).productivity });
  }
  classified.sort((left, right) => left.start - right.start || left.end - right.end);

  const days = new Map<string, MutableFacts>();
  const factsFor = (day: string): MutableFacts => {
    let facts = days.get(day);
    if (!facts) {
      facts = { trackedSeconds: 0, focusSeconds: 0, driftSeconds: 0, longestFocusRunSeconds: 0, earlyFocusSeconds: 0, lateFocusSeconds: 0 };
      days.set(day, facts);
    }
    return facts;
  };

  for (const entry of classified) {
    for (const piece of splitByLogicalDay(entry, rangeStart, rangeEnd, startOfDayMinutes)) {
      const facts = factsFor(piece.day);
      facts.trackedSeconds += piece.seconds;
      if (entry.productivity === "focus") {
        facts.focusSeconds += piece.seconds;
        facts.earlyFocusSeconds += clockWindowSeconds(entry, piece.start, piece.end, ACHIEVEMENT_EARLY_WINDOW);
        facts.lateFocusSeconds += clockWindowSeconds(entry, piece.start, piece.end, ACHIEVEMENT_LATE_WINDOW);
      } else if (entry.productivity === "drift") {
        facts.driftSeconds += piece.seconds;
      }
    }
  }

  for (const run of focusRuns(classified)) {
    if (run.start < rangeStart || run.start >= rangeEnd) continue;
    const day = logicalDayIsoDateForDate(new Date(run.start), startOfDayMinutes);
    const facts = days.get(day);
    if (facts) facts.longestFocusRunSeconds = Math.max(facts.longestFocusRunSeconds, run.seconds);
  }

  const result: AchievementDayFacts[] = [];
  for (let day = startDay; day <= endDay; day = shiftIsoDate(day, 1)) {
    const facts = days.get(day);
    if (!facts || facts.trackedSeconds <= 0) continue;
    result.push({
      day,
      trackedSeconds: Math.round(facts.trackedSeconds),
      focusSeconds: Math.round(facts.focusSeconds),
      driftSeconds: Math.round(facts.driftSeconds),
      longestFocusRunSeconds: Math.round(facts.longestFocusRunSeconds),
      earlyFocusSeconds: Math.round(facts.earlyFocusSeconds),
      lateFocusSeconds: Math.round(facts.lateFocusSeconds),
    });
  }
  return result;
}

type DayPiece = { readonly day: string; readonly start: number; readonly end: number; readonly seconds: number };

function splitByLogicalDay(entry: ClassifiedSegment, rangeStart: number, rangeEnd: number, startOfDayMinutes: number): DayPiece[] {
  const { segment, start, end } = entry;
  // A freshly sampled point keeps its recorded duration, as the focus totals do.
  if (start === end) {
    if (start < rangeStart || start >= rangeEnd || !Number.isFinite(segment.durationSeconds)) return [];
    const day = logicalDayIsoDateForDate(new Date(start), startOfDayMinutes);
    return [{ day, start, end, seconds: Math.max(0, segment.durationSeconds) }];
  }
  const pieces: DayPiece[] = [];
  let cursor = Math.max(start, rangeStart);
  const clippedEnd = Math.min(end, rangeEnd);
  while (cursor < clippedEnd) {
    const day = logicalDayIsoDateForDate(new Date(cursor), startOfDayMinutes);
    const dayEnd = Math.min(clippedEnd, logicalDayEndExclusiveMs(day, startOfDayMinutes));
    if (dayEnd <= cursor) break;
    const seconds = activitySecondsWithinInterval(segment, cursor, dayEnd);
    if (seconds > 0) pieces.push({ day, start: cursor, end: dayEnd, seconds });
    cursor = dayEnd;
  }
  return pieces;
}

function clockWindowSeconds(
  entry: ClassifiedSegment,
  start: number,
  end: number,
  window: { readonly fromHour: number; readonly toHour: number },
): number {
  if (start === end) {
    const hour = new Date(start).getHours();
    return hour >= window.fromHour && hour < window.toHour ? Math.max(0, entry.segment.durationSeconds) : 0;
  }
  let total = 0;
  const first = new Date(start);
  for (let date = new Date(first.getFullYear(), first.getMonth(), first.getDate()); date.getTime() < end; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
    const windowStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), window.fromHour).getTime();
    const windowEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), window.toHour).getTime();
    const from = Math.max(start, windowStart);
    const to = Math.min(end, windowEnd);
    if (to > from) total += activitySecondsWithinInterval(entry.segment, from, to);
  }
  return total;
}

function elapsedSeconds(entry: ClassifiedSegment): number {
  if (entry.start === entry.end) return Number.isFinite(entry.segment.durationSeconds) ? Math.max(0, entry.segment.durationSeconds) : 0;
  return activitySecondsWithinInterval(entry.segment, entry.start, entry.end);
}

function focusRuns(classified: readonly ClassifiedSegment[]): { start: number; seconds: number }[] {
  const runs: { start: number; seconds: number }[] = [];
  let runStart = Number.NaN;
  let runEnd = Number.NEGATIVE_INFINITY;
  let runSeconds = 0;
  const finish = () => {
    if (runSeconds > 0) runs.push({ start: runStart, seconds: runSeconds });
    runStart = Number.NaN;
    runEnd = Number.NEGATIVE_INFINITY;
    runSeconds = 0;
  };
  for (const entry of classified) {
    if (entry.productivity !== "focus") {
      finish();
      continue;
    }
    if (runSeconds > 0 && entry.start > runEnd + ACHIEVEMENT_FOCUS_RUN_MAX_GAP_MS) finish();
    if (runSeconds === 0) runStart = entry.start;
    runSeconds += elapsedSeconds(entry);
    runEnd = Math.max(runEnd, entry.end);
  }
  finish();
  return runs;
}

