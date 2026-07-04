import { classifyActivity } from "@drifty/domain";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { localDateKey, weekdayOrderIndex } from "../../lib/formatting";

const WEEKDAY_COUNT = 7;
const HOURS_PER_DAY = 24;

export type AttentionRhythmState = "focus" | "drift" | "neutral";

export interface AttentionRhythmCell {
  readonly weekdayIndex: number;
  readonly hour: number;
  readonly state: AttentionRhythmState;
  readonly intensity: 0 | 1 | 2 | 3;
}

type AttentionRhythmVisibility = {
  readonly startDay?: string;
  readonly visibleThroughDay?: string;
  readonly averagingRange?: {
    readonly startDay: string;
    readonly endDay: string;
  };
};

type HourOverlap = {
  readonly weekdayIndex: number;
  readonly hour: number;
  readonly seconds: number;
};

type RhythmTotals = Record<AttentionRhythmState, number[][]>;

function buildEmptyGrid(): number[][] {
  return Array.from({ length: WEEKDAY_COUNT }, () => new Array<number>(HOURS_PER_DAY).fill(0));
}

function buildRhythmTotals(): RhythmTotals {
  return {
    focus: buildEmptyGrid(),
    drift: buildEmptyGrid(),
    neutral: buildEmptyGrid(),
  };
}

function weekdayIndexForDay(day?: string): number | null {
  if (!day) return null;
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return weekdayOrderIndex(date);
}

function orderedWeekdayIndexes(startDay?: string): readonly number[] {
  const startIndex = weekdayIndexForDay(startDay) ?? 0;
  return Array.from({ length: WEEKDAY_COUNT }, (_, offset) => (startIndex + offset) % WEEKDAY_COUNT);
}

function validDayDate(day: string): Date | null {
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function visibleThroughDay(visibility?: AttentionRhythmVisibility): string | null {
  if (weekdayIndexForDay(visibility?.startDay) !== null) return null;
  const day = visibility?.visibleThroughDay;
  if (!day) return null;
  return validDayDate(day) === null ? null : day;
}

function buildWeekdayOccurrenceCounts(visibility?: AttentionRhythmVisibility): number[] | null {
  const range = visibility?.averagingRange;
  if (!range) return null;

  const startDate = validDayDate(range.startDay);
  const endDate = validDayDate(range.endDay);
  if (startDate === null || endDate === null || endDate < startDate) return null;

  const counts = new Array<number>(WEEKDAY_COUNT).fill(0);
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    counts[weekdayOrderIndex(cursor)] += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return counts;
}

function averageGridByWeekdayOccurrences(grid: number[][], weekdayOccurrences: readonly number[]): number[][] {
  return grid.map((row, weekdayIndex) => {
    const occurrences = weekdayOccurrences[weekdayIndex] ?? 0;
    if (occurrences <= 1) return row.slice();
    return row.map((value) => value / occurrences);
  });
}

function averageRhythmTotals(totals: RhythmTotals, visibility?: AttentionRhythmVisibility): RhythmTotals {
  const weekdayOccurrences = buildWeekdayOccurrenceCounts(visibility);
  if (weekdayOccurrences === null) return totals;
  return {
    focus: averageGridByWeekdayOccurrences(totals.focus, weekdayOccurrences),
    drift: averageGridByWeekdayOccurrences(totals.drift, weekdayOccurrences),
    neutral: averageGridByWeekdayOccurrences(totals.neutral, weekdayOccurrences),
  };
}

function nextHourBoundaryMs(valueMs: number): number {
  const next = new Date(valueMs);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime();
}

function segmentHourOverlaps(segment: ActivitySegment, visibleThrough: string | null): HourOverlap[] {
  const segmentStartMs = new Date(segment.startedAt).getTime();
  const segmentEndMs = new Date(segment.endedAt).getTime();
  if (!Number.isFinite(segmentStartMs) || !Number.isFinite(segmentEndMs) || segmentEndMs <= segmentStartMs) return [];

  const overlaps: HourOverlap[] = [];
  let cursorMs = segmentStartMs;
  while (cursorMs < segmentEndMs) {
    const started = new Date(cursorMs);
    const overlapDay = localDateKey(started);
    if (visibleThrough !== null && overlapDay > visibleThrough) break;

    const overlapEndMs = Math.min(segmentEndMs, nextHourBoundaryMs(cursorMs));
    const seconds = Math.max(0, Math.round((overlapEndMs - cursorMs) / 1000));
    if (seconds > 0) {
      overlaps.push({
        weekdayIndex: weekdayOrderIndex(started),
        hour: started.getHours(),
        seconds,
      });
    }
    cursorMs = overlapEndMs;
  }
  return overlaps;
}

function addToGrid(grid: number[][], overlap: HourOverlap): void {
  const row = grid[overlap.weekdayIndex];
  if (!row) return;
  row[overlap.hour] = (row[overlap.hour] ?? 0) + overlap.seconds;
}

function maxGridValue(grid: number[][]): number {
  let max = 0;
  for (const row of grid) {
    for (const value of row) {
      if (value > max) max = value;
    }
  }
  return max;
}

function intensityTier(value: number, max: number): 1 | 2 | 3 {
  if (max <= 0) return 1;
  const ratio = value / max;
  if (ratio >= 0.66) return 3;
  if (ratio >= 0.33) return 2;
  return 1;
}

function buildCell(totals: RhythmTotals, weekdayIndex: number, hour: number, maxFocus: number, maxDrift: number): AttentionRhythmCell {
  const focusSeconds = totals.focus[weekdayIndex]?.[hour] ?? 0;
  const driftSeconds = totals.drift[weekdayIndex]?.[hour] ?? 0;
  const neutralSeconds = totals.neutral[weekdayIndex]?.[hour] ?? 0;
  const total = focusSeconds + driftSeconds + neutralSeconds;
  if (total <= 0) return { weekdayIndex, hour, state: "neutral", intensity: 0 };
  if (focusSeconds >= driftSeconds && focusSeconds >= neutralSeconds && focusSeconds > 0) {
    return { weekdayIndex, hour, state: "focus", intensity: intensityTier(focusSeconds, maxFocus) };
  }
  if (driftSeconds >= focusSeconds && driftSeconds >= neutralSeconds && driftSeconds > 0) {
    return { weekdayIndex, hour, state: "drift", intensity: intensityTier(driftSeconds, maxDrift) };
  }
  return { weekdayIndex, hour, state: "neutral", intensity: 0 };
}

export function buildAttentionRhythm(
  segments: ActivitySegment[],
  options?: ClassificationOptions,
  visibility?: AttentionRhythmVisibility,
): AttentionRhythmCell[] {
  const totals = buildRhythmTotals();
  const cutoffDay = visibleThroughDay(visibility);

  for (const segment of segments) {
    const { category, productivity } = classifyActivity(segment, options);
    if (category === "unknown") continue;
    const grid = totals[productivity];
    for (const overlap of segmentHourOverlaps(segment, cutoffDay)) {
      addToGrid(grid, overlap);
    }
  }

  const averagedTotals = averageRhythmTotals(totals, visibility);
  const maxFocus = maxGridValue(averagedTotals.focus);
  const maxDrift = maxGridValue(averagedTotals.drift);
  const cells: AttentionRhythmCell[] = [];
  for (const weekdayIndex of orderedWeekdayIndexes(visibility?.startDay)) {
    for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
      cells.push(buildCell(averagedTotals, weekdayIndex, hour, maxFocus, maxDrift));
    }
  }
  return cells;
}
