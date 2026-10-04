import {
  aggregateDeviceElapsedTime, activitySecondsWithinInterval, activityTimeBounds, classifyActivity, logicalDayEndExclusiveMs, logicalDayIsoDateForDate,
  logicalDayStartMs, shiftIsoDate,
  type ActivitySegment, type ClassificationOptions,
} from "@drifty/domain";

export type FocusCalendarDay = {
  readonly day: string;
  readonly trackedSeconds: number;
  readonly focusSeconds: number;
  readonly level: number;
};

export type FocusCalendarVariant = "year" | "half" | "half-compact" | "quarter";
export type FocusCalendarQuartiles = readonly [number, number, number] | null;

/** Review alternatives share the same date aggregation and adaptive colour scale. */
export function focusCalendarWindow(endDay: string, variant: FocusCalendarVariant) {
  if (variant === "year") return { startDay: `${endDay.slice(0, 4)}-01-01`, gridEndDay: `${endDay.slice(0, 4)}-12-31` };
  const [year, month, day] = endDay.split("-").map(Number);
  const months = variant === "quarter" ? 3 : 5;
  const start = new Date(year, month - 1 - months, 1, 12);
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0, 12).getDate();
  const boundary = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  return { startDay: shiftIsoDate(boundary, 1), gridEndDay: endDay };
}

function quantile(sorted: readonly number[], probability: number): number {
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const weight = index - lower;
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * weight;
}

/** GitHub-style relative intensity: zero is separate, positive focus days form four quartiles. */
export function focusCalendarQuartiles(values: readonly number[]): FocusCalendarQuartiles {
  const sorted = values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return [quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75)];
}

export function focusCalendarLevel(seconds: number, quartiles: FocusCalendarQuartiles): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  // With no completed comparison day, use the neutral midpoint. The UI marks
  // this as an uncalibrated value instead of making a relative claim.
  if (!quartiles) return 2;

  const lowerLevel = 1 + quartiles.filter(threshold => seconds > threshold).length;
  const upperLevel = 1 + quartiles.filter(threshold => seconds >= threshold).length;
  // Duplicate quartile boundaries are common when daily totals tie. Their
  // midpoint keeps equal durations in one honest, non-extreme colour bucket.
  return Math.floor((lowerLevel + upperLevel) / 2);
}

export function buildFocusCalendar(
  segments: readonly ActivitySegment[], startDay: string, endDay: string,
  options?: ClassificationOptions, startOfDayMinutes = 0, calibrationEndDay = endDay,
): FocusCalendarDay[] {
  const totals = new Map<string, { trackedSeconds: number; focusSeconds: number }>();
  const rangeStart = logicalDayStartMs(startDay, startOfDayMinutes);
  const rangeEnd = logicalDayEndExclusiveMs(endDay, startOfDayMinutes);
  for (const segment of aggregateDeviceElapsedTime(segments)) {
    const { start, end } = activityTimeBounds(segment);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const focus = classifyActivity(segment, options).productivity === "focus";
    const add = (day: string, seconds: number) => {
      const total = totals.get(day) ?? { trackedSeconds: 0, focusSeconds: 0 };
      total.trackedSeconds += seconds;
      if (focus) total.focusSeconds += seconds;
      totals.set(day, total);
    };
    // Match the shared focus totals' handling of newly sampled point segments.
    if (start === end) {
      if (start >= rangeStart && start < rangeEnd && Number.isFinite(segment.durationSeconds)) {
        add(logicalDayIsoDateForDate(new Date(start), startOfDayMinutes), Math.max(0, segment.durationSeconds));
      }
      continue;
    }
    let cursor = Math.max(start, rangeStart);
    const clippedEnd = Math.min(end, rangeEnd);
    while (cursor < clippedEnd) {
      const day = logicalDayIsoDateForDate(new Date(cursor), startOfDayMinutes);
      const next = Math.min(clippedEnd, logicalDayEndExclusiveMs(day, startOfDayMinutes));
      add(day, activitySecondsWithinInterval(segment, cursor, next));
      cursor = next;
    }
  }
  const result: Array<Omit<FocusCalendarDay, "level">> = [];
  for (let day = startDay; day <= endDay; day = shiftIsoDate(day, 1)) {
    const total = totals.get(day) ?? { trackedSeconds: 0, focusSeconds: 0 };
    result.push({ day, ...total });
  }
  const quartiles = focusCalendarQuartiles(result
    .filter(day => day.day <= calibrationEndDay)
    .map(day => day.focusSeconds));
  return result.map(day => ({ ...day, level: focusCalendarLevel(day.focusSeconds, quartiles) }));
}
