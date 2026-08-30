// Pure data assembly for the shareable daily summary card.
//
// A share card only ever contains aggregates: focus totals, category durations,
// hourly focus/drift buckets, and derived stats. App names, site domains, window
// titles, and project names must never enter `ShareCardData` — the renderer
// (shareCardSvg.ts) draws exactly what this module produces, so the privacy
// boundary is enforced here.

import type { ActivityCategory, CategoryDuration, FlowBlock, ProductivityDuration } from "@drifty/domain";
import { categoryLabel } from "../../lib/activityLabels";
import { formatDateRangeLabel, UI_LOCALE } from "../../lib/formatting";
import type { WeekCalendarEvent, WeekDayRow } from "../dashboard/weekCalendar";

export type ShareCardSliceKey = ActivityCategory | "other";

export interface ShareCardCategorySlice {
  readonly key: ShareCardSliceKey;
  readonly label: string;
  readonly seconds: number;
  /** Share of the day's tracked total, 0..1. */
  readonly ratio: number;
}

export interface ShareCardHour {
  readonly hour: number;
  readonly focusSeconds: number;
  readonly driftSeconds: number;
  readonly neutralSeconds: number;
}

/** Aggregate focus / neutral / drift composition for a shared card. */
export interface ShareCardProductivitySlice {
  readonly key: ProductivityDuration["productivity"];
  readonly seconds: number;
  readonly ratio: number;
}

export interface ShareCardData {
  /** ISO day, e.g. "2026-07-18". */
  readonly day: string;
  /** e.g. "Friday". */
  readonly weekdayLabel: string;
  /** e.g. "Jul 18". */
  readonly dateLabel: string;
  readonly totalSeconds: number;
  readonly focusSeconds: number;
  /** Whether the selected day is the current logical day. */
  readonly isCurrentPeriod: boolean;
  /** Elapsed share of the comparison period, 0..1; 1 for completed periods. */
  readonly comparisonProgress: number;
  /** Focus share of classified time, 0..100 rounded. */
  readonly focusPercent: number;
  /** Exact aggregate productivity mix for the selected day. */
  readonly productivitySlices: readonly ShareCardProductivitySlice[];
  /** Focus delta vs the previous day in seconds; null when unknown. */
  readonly deltaSeconds: number | null;
  /** Up to five categories; unclassified stays explicit and named overflow becomes "other". */
  readonly slices: readonly ShareCardCategorySlice[];
  /** 24 hour buckets of focus/drift/neutral seconds. */
  readonly hours: readonly ShareCardHour[];
  readonly longestFocusSeconds: number;
  /** Best 2-hour focus window, e.g. "14–16h"; null when the day has no focus. */
  readonly peakFocusLabel: string | null;
}

export interface BuildShareCardDataInput {
  readonly day: string;
  readonly totalSeconds: number;
  readonly categoryTotals: readonly CategoryDuration[];
  readonly productivityTotals: readonly ProductivityDuration[];
  readonly flowBlocks: readonly FlowBlock[];
  readonly deltaSeconds: number | null;
  readonly comparisonProgress?: number;
  readonly isCurrentPeriod?: boolean;
}

const MAX_CATEGORY_SLICES = 5;
/** Focus stretches separated by less than this still count as one session. */
const FOCUS_RUN_MAX_GAP_SECONDS = 5 * 60;
const PEAK_WINDOW_HOURS = 2;

export function buildShareCardData({
  day,
  totalSeconds,
  categoryTotals,
  productivityTotals,
  flowBlocks,
  deltaSeconds,
  comparisonProgress = 1,
  isCurrentPeriod = false,
}: BuildShareCardDataInput): ShareCardData {
  const parsed = new Date(`${day}T12:00:00`);
  const weekdayLabel = parsed.toLocaleDateString(UI_LOCALE, { weekday: "long" });
  const dateLabel = parsed.toLocaleDateString(UI_LOCALE, { month: "short", day: "numeric" });

  const trackedSeconds = Math.max(
    totalSeconds,
    categoryTotals.reduce((sum, entry) => sum + entry.totalSeconds, 0),
  );

  const focusEntry = productivityTotals.find((entry) => entry.productivity === "focus");
  const focusSeconds = focusEntry?.totalSeconds ?? 0;
  const focusPercent = Math.round((focusEntry?.ratio ?? 0) * 100);

  return {
    day,
    weekdayLabel,
    dateLabel,
    totalSeconds: trackedSeconds,
    focusSeconds,
    isCurrentPeriod,
    comparisonProgress,
    focusPercent,
    productivitySlices: buildProductivitySlices(productivityTotals),
    deltaSeconds,
    slices: buildSlices(categoryTotals, trackedSeconds),
    hours: buildHours(flowBlocks),
    longestFocusSeconds: buildLongestFocusRunSeconds(flowBlocks),
    peakFocusLabel: buildPeakFocusLabel(flowBlocks),
  };
}

function buildProductivitySlices(
  productivityTotals: readonly ProductivityDuration[],
): ShareCardProductivitySlice[] {
  return productivityTotals
    .filter((entry) => entry.totalSeconds > 0)
    .map((entry) => ({
      key: entry.productivity,
      seconds: entry.totalSeconds,
      ratio: Number.isFinite(entry.ratio) ? Math.max(0, Math.min(1, entry.ratio)) : 0,
    }));
}

/** Keep unclassified explicit; only named-category overflow folds into "other". */
function buildSlices(
  categoryTotals: readonly CategoryDuration[],
  trackedSeconds: number,
): ShareCardCategorySlice[] {
  const active = categoryTotals.filter((entry) => entry.totalSeconds > 0);
  const named = active
    .filter((entry) => entry.category !== "unknown")
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
  const unknownSeconds = active
    .filter((entry) => entry.category === "unknown")
    .reduce((sum, entry) => sum + entry.totalSeconds, 0);
  const namedSlots = MAX_CATEGORY_SLICES - (unknownSeconds > 0 ? 1 : 0);
  const needsOther = named.length > namedSlots;
  const visibleNamedCount = needsOther ? Math.max(0, namedSlots - 1) : named.length;
  const top = named.slice(0, visibleNamedCount);
  const otherSeconds = named.slice(visibleNamedCount).reduce((sum, entry) => sum + entry.totalSeconds, 0);

  const ratioOf = (seconds: number) => (trackedSeconds > 0 ? seconds / trackedSeconds : 0);
  const slices: ShareCardCategorySlice[] = top.map((entry) => ({
    key: entry.category,
    label: categoryLabel(entry.category),
    seconds: entry.totalSeconds,
    ratio: ratioOf(entry.totalSeconds),
  }));
  if (otherSeconds > 0) {
    slices.push({ key: "other", label: "Other", seconds: otherSeconds, ratio: ratioOf(otherSeconds) });
  }
  if (unknownSeconds > 0) {
    slices.push({
      key: "unknown",
      label: categoryLabel("unknown"),
      seconds: unknownSeconds,
      ratio: ratioOf(unknownSeconds),
    });
  }
  return slices;
}

function buildHours(flowBlocks: readonly FlowBlock[]): ShareCardHour[] {
  const focus = new Array<number>(24).fill(0);
  const drift = new Array<number>(24).fill(0);
  const neutral = new Array<number>(24).fill(0);
  for (const block of flowBlocks) {
    const hour = Math.floor(block.minuteOfDay / 60) % 24;
    if (hour < 0) continue;
    if (block.productivity === "focus") focus[hour] += block.durationSeconds;
    else if (block.productivity === "drift") drift[hour] += block.durationSeconds;
    else neutral[hour] += block.durationSeconds;
  }
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    focusSeconds: focus[hour],
    driftSeconds: drift[hour],
    neutralSeconds: neutral[hour],
  }));
}

/** Longest focus stretch, merging gaps shorter than FOCUS_RUN_MAX_GAP_SECONDS. */
function buildLongestFocusRunSeconds(flowBlocks: readonly FlowBlock[]): number {
  const intervals = flowBlocks
    .filter((block) => block.productivity === "focus" && block.durationSeconds > 0)
    .map((block) => {
      const start = block.minuteOfDay * 60;
      return { start, end: start + block.durationSeconds };
    })
    .sort((a, b) => a.start - b.start);
  let longest = 0;
  let runStart: number | null = null;
  let runEnd = 0;
  for (const interval of intervals) {
    if (runStart === null || interval.start - runEnd > FOCUS_RUN_MAX_GAP_SECONDS) {
      runStart = interval.start;
      runEnd = interval.end;
    } else {
      runEnd = Math.max(runEnd, interval.end);
    }
    longest = Math.max(longest, runEnd - runStart);
  }
  return longest;
}

export interface ShareWeekCardDay {
  readonly day: string;
  /** Single-letter column label, e.g. "M". */
  readonly letter: string;
  readonly focusSeconds: number;
  readonly isBest: boolean;
}

export interface ShareWeekCardData {
  readonly startDay: string;
  readonly endDay: string;
  /** e.g. "Week 29". */
  readonly weekLabel: string;
  /** e.g. "Jul 13–19" or "Jun 29–Jul 5". */
  readonly rangeLabel: string;
  readonly totalSeconds: number;
  readonly focusSeconds: number;
  /** Whether the selected range contains the current logical day. */
  readonly isCurrentPeriod: boolean;
  readonly comparisonProgress: number;
  /** Average focus per tracked day (including tracked zero-focus days). */
  readonly avgDailyFocusSeconds: number;
  readonly focusPercent: number;
  /** Exact aggregate productivity mix for the selected week. */
  readonly productivitySlices: readonly ShareCardProductivitySlice[];
  /** Focus delta vs the previous week in seconds; null when unknown. */
  readonly deltaSeconds: number | null;
  readonly days: readonly ShareWeekCardDay[];
  /** Full weekday name of the best day, e.g. "Thursday"; null on an empty week. */
  readonly bestDayLabel: string | null;
  readonly longestFocusSeconds: number;
  readonly slices: readonly ShareCardCategorySlice[];
}

export interface BuildShareWeekCardDataInput {
  readonly startDay: string;
  readonly endDay: string;
  readonly totalSeconds: number;
  readonly categoryTotals: readonly CategoryDuration[];
  readonly productivityTotals: readonly ProductivityDuration[];
  readonly weekRows: readonly WeekDayRow[];
  readonly calendarEvents: ReadonlyMap<string, readonly WeekCalendarEvent[]>;
  readonly deltaSeconds: number | null;
  readonly comparisonProgress?: number;
  readonly isCurrentPeriod?: boolean;
}

export function buildShareWeekCardData({
  startDay,
  endDay,
  totalSeconds,
  categoryTotals,
  productivityTotals,
  weekRows,
  calendarEvents,
  deltaSeconds,
  comparisonProgress = 1,
  isCurrentPeriod = false,
}: BuildShareWeekCardDataInput): ShareWeekCardData {
  const trackedSeconds = Math.max(
    totalSeconds,
    categoryTotals.reduce((sum, entry) => sum + entry.totalSeconds, 0),
  );
  const focusEntry = productivityTotals.find((entry) => entry.productivity === "focus");

  const bestRow = weekRows.reduce<WeekDayRow | null>(
    (best, row) => (row.focusSeconds > (best?.focusSeconds ?? 0) ? row : best),
    null,
  );
  const days: ShareWeekCardDay[] = weekRows.map((row) => ({
    day: row.day,
    letter: (row.dayName.charAt(0) || "·").toUpperCase(),
    focusSeconds: row.focusSeconds,
    isBest: bestRow !== null && row.day === bestRow.day,
  }));
  const activeDays = weekRows.filter((day) => day.totalSeconds > 0).length;
  const dayFocusSum = days.reduce((sum, day) => sum + day.focusSeconds, 0);

  return {
    startDay,
    endDay,
    weekLabel: `Week ${isoWeekNumber(startDay)}`,
    rangeLabel: formatDateRangeLabel(startDay, endDay),
    totalSeconds: trackedSeconds,
    focusSeconds: focusEntry?.totalSeconds ?? 0,
    isCurrentPeriod,
    comparisonProgress,
    avgDailyFocusSeconds: activeDays > 0 ? Math.round(dayFocusSum / activeDays) : 0,
    focusPercent: Math.round((focusEntry?.ratio ?? 0) * 100),
    productivitySlices: buildProductivitySlices(productivityTotals),
    deltaSeconds,
    days,
    bestDayLabel: bestRow
      ? new Date(`${bestRow.day}T12:00:00`).toLocaleDateString(UI_LOCALE, { weekday: "long" })
      : null,
    longestFocusSeconds: buildWeekLongestFocusSeconds(calendarEvents),
    slices: buildSlices(categoryTotals, trackedSeconds),
  };
}

/** ISO-8601 week number of the given ISO day. */
function isoWeekNumber(day: string): number {
  const date = new Date(`${day}T12:00:00`);
  const target = new Date(date.valueOf());
  target.setDate(target.getDate() - ((date.getDay() + 6) % 7) + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  return 1 + Math.round((target.valueOf() - firstThursday.valueOf()) / (7 * 24 * 3600 * 1000));
}

/** Longest per-day focus stretch across the week from calendar events (5-min gap merge). */
function buildWeekLongestFocusSeconds(
  calendarEvents: ReadonlyMap<string, readonly WeekCalendarEvent[]>,
): number {
  let longest = 0;
  for (const events of calendarEvents.values()) {
    const intervals = events
      .filter((event) => event.productivity === "focus" && event.durationMinutes > 0)
      .map((event) => ({
        start: event.topMinutes * 60,
        end: (event.topMinutes + event.durationMinutes) * 60,
      }))
      .sort((a, b) => a.start - b.start);
    let runStart: number | null = null;
    let runEnd = 0;
    for (const interval of intervals) {
      if (runStart === null || interval.start - runEnd > FOCUS_RUN_MAX_GAP_SECONDS) {
        runStart = interval.start;
        runEnd = interval.end;
      } else {
        runEnd = Math.max(runEnd, interval.end);
      }
      longest = Math.max(longest, runEnd - runStart);
    }
  }
  return longest;
}

function buildPeakFocusLabel(flowBlocks: readonly FlowBlock[]): string | null {
  const focusByHour = new Array<number>(24).fill(0);
  let hasFocus = false;
  for (const block of flowBlocks) {
    if (block.productivity !== "focus" || block.durationSeconds <= 0) continue;
    const hour = Math.floor(block.minuteOfDay / 60) % 24;
    focusByHour[hour] += block.durationSeconds;
    hasFocus = true;
  }
  if (!hasFocus) return null;
  let bestStart = 0;
  let bestTotal = -1;
  for (let start = 0; start <= 24 - PEAK_WINDOW_HOURS; start += 1) {
    let total = 0;
    for (let offset = 0; offset < PEAK_WINDOW_HOURS; offset += 1) total += focusByHour[start + offset];
    if (total > bestTotal) {
      bestTotal = total;
      bestStart = start;
    }
  }
  return `${bestStart}–${bestStart + PEAK_WINDOW_HOURS}h`;
}
