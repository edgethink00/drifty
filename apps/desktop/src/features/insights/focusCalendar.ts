import {
  classifyActivity, logicalDayEndExclusiveMs, logicalDayIsoDateForDate,
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

/** Review alternatives share the same date aggregation and colour thresholds. */
export function focusCalendarWindow(endDay: string, variant: FocusCalendarVariant) {
  if (variant === "year") return { startDay: `${endDay.slice(0, 4)}-01-01`, gridEndDay: `${endDay.slice(0, 4)}-12-31` };
  const [year, month, day] = endDay.split("-").map(Number);
  const months = variant === "quarter" ? 3 : 5;
  const start = new Date(year, month - 1 - months, 1, 12);
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0, 12).getDate();
  const boundary = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  return { startDay: shiftIsoDate(boundary, 1), gridEndDay: endDay };
}

/** Fixed hour thresholds make the same colour comparable across dates. */
export function focusCalendarLevel(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds < 3600) return 1;
  if (seconds < 7200) return 2;
  if (seconds < 14400) return 3;
  return 4;
}

export function buildFocusCalendar(
  segments: readonly ActivitySegment[], startDay: string, endDay: string,
  options?: ClassificationOptions, startOfDayMinutes = 0,
): FocusCalendarDay[] {
  const totals = new Map<string, { trackedSeconds: number; focusSeconds: number }>();
  const rangeStart = logicalDayStartMs(startDay, startOfDayMinutes);
  const rangeEnd = logicalDayEndExclusiveMs(endDay, startOfDayMinutes);
  for (const segment of segments) {
    const start = new Date(segment.startedAt).getTime();
    const end = new Date(segment.endedAt).getTime();
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
      add(day, (next - cursor) / 1000);
      cursor = next;
    }
  }
  const result: FocusCalendarDay[] = [];
  for (let day = startDay; day <= endDay; day = shiftIsoDate(day, 1)) {
    const total = totals.get(day) ?? { trackedSeconds: 0, focusSeconds: 0 };
    result.push({ day, ...total, level: focusCalendarLevel(total.focusSeconds) });
  }
  return result;
}
