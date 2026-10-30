import { shiftIsoDate } from "@drifty/domain";

import { getCalendarWeekStartDay } from "../features/dashboard/weekCalendar";
import type { StartOfWeek } from "../features/settings/settingsStorage";

/** Day picks one day; week picks the whole week a day falls in. */
export type DateJumpUnit = "day" | "week";

/** The first day of the month a day falls in. */
export function calendarMonthOf(day: string): string {
  return day.slice(0, 8) + "01";
}

/** The first day of the month `delta` months away. */
export function shiftCalendarMonth(month: string, delta: number): string {
  const [year, value] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, value - 1 + delta, 1)).toISOString().slice(0, 10);
}

/**
 * A month as whole weeks that start on the reader's first weekday, grouped the
 * way the Week dashboard groups them. The neighbouring months' days fill the
 * first and last rows, so every row is one complete, pickable week.
 */
export function calendarMonthWeeks(month: string, startOfWeek: StartOfWeek): string[][] {
  const first = calendarMonthOf(month);
  const next = shiftCalendarMonth(first, 1);
  const weeks: string[][] = [];
  for (let start = getCalendarWeekStartDay(first, startOfWeek); start < next; start = shiftIsoDate(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => shiftIsoDate(start, index)));
  }
  return weeks;
}

/** The same date in another month, held to that month's last day (Jan 31 → Feb 28). */
function shiftDayByMonths(day: string, delta: number): string {
  const month = shiftCalendarMonth(calendarMonthOf(day), delta);
  const last = shiftIsoDate(shiftCalendarMonth(month, 1), -1);
  const target = month.slice(0, 8) + day.slice(8);
  return target > last ? last : target;
}

/**
 * The last day that can be picked or focused: today, or for weeks the end of
 * this week, so the current week stays whole.
 */
export function lastReachableDay(unit: DateJumpUnit, today: string, startOfWeek: StartOfWeek): string {
  return unit === "week" ? shiftIsoDate(getCalendarWeekStartDay(today, startOfWeek), 6) : today;
}

/**
 * The day a pick asks for. A week keeps the clicked day as its anchor (Day
 * opens on it after switching), never a day after today.
 */
export function pickedDay(day: string, today: string): string {
  return day > today ? today : day;
}

/** Where a grid key moves focus from a day, or null for keys the grid leaves alone. */
export function movedFocusDay(day: string, key: string, startOfWeek: StartOfWeek): string | null {
  switch (key) {
    case "ArrowLeft":
      return shiftIsoDate(day, -1);
    case "ArrowRight":
      return shiftIsoDate(day, 1);
    case "ArrowUp":
      return shiftIsoDate(day, -7);
    case "ArrowDown":
      return shiftIsoDate(day, 7);
    case "PageUp":
      return shiftDayByMonths(day, -1);
    case "PageDown":
      return shiftDayByMonths(day, 1);
    case "Home":
      return getCalendarWeekStartDay(day, startOfWeek);
    case "End":
      return shiftIsoDate(getCalendarWeekStartDay(day, startOfWeek), 6);
    default:
      return null;
  }
}
