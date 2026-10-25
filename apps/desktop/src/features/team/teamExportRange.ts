/**
 * Settings › Export's days (owner decision 2026-10-22): a start and an end
 * day, as Dayflow's export takes them, apart from the team page's own period;
 * it opens on this week.
 */
import { shiftIsoDate } from "@drifty/domain";

import { isoWeekday } from "./teamFocusModel";

export const TEAM_EXPORT_PRESETS = ["thisWeek", "lastWeek", "thisMonth", "lastMonth", "last90", "custom"] as const;
export type TeamExportPreset = (typeof TEAM_EXPORT_PRESETS)[number];

export type TeamExportWindow = { readonly start_date: string; readonly end_date: string };

/** The longest range one export takes (the server reads at most 400 days at a time). */
export const TEAM_EXPORT_MAX_DAYS = 366;

function monthStart(day: string): string {
  return day.slice(0, 8) + "01";
}

function monthEnd(day: string): string {
  const [year, month] = day.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day.slice(0, 8) + String(last).padStart(2, "0");
}

/** A preset's days, ending no later than today; weeks start on Monday. */
export function teamExportPresetWindow(preset: Exclude<TeamExportPreset, "custom">, today: string): TeamExportWindow {
  const monday = shiftIsoDate(today, -(isoWeekday(today) - 1));
  switch (preset) {
    case "thisWeek":
      return { start_date: monday, end_date: today };
    case "lastWeek":
      return { start_date: shiftIsoDate(monday, -7), end_date: shiftIsoDate(monday, -1) };
    case "thisMonth":
      return { start_date: monthStart(today), end_date: today };
    case "lastMonth": {
      const lastOfPrevious = shiftIsoDate(monthStart(today), -1);
      return { start_date: monthStart(lastOfPrevious), end_date: lastOfPrevious };
    }
    case "last90":
      return { start_date: shiftIsoDate(today, -89), end_date: today };
  }
}

export function teamExportDayCount(window: TeamExportWindow): number {
  const start = Date.parse(window.start_date + "T00:00:00Z");
  const end = Date.parse(window.end_date + "T00:00:00Z");
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * A day as its field shows it: in full, or short with the weekday and the
 * year only when it is not this year's.
 */
export function teamExportDayText(day: string, locale: string, today: string, format: "long" | "short"): string {
  const date = new Date(day + "T00:00:00Z");
  if (format === "long") return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
  const year = day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" as const };
  // Korean drops the weekday's parentheses once a year joins; keep "10월 19일 (월)" either way.
  if (locale.startsWith("ko")) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
    return new Intl.DateTimeFormat(locale, { ...year, month: "long", day: "numeric", timeZone: "UTC" }).format(date) + " (" + weekday + ")";
  }
  return new Intl.DateTimeFormat(locale, { ...year, month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(date);
}

/** How a calendar day sits in the range being picked. */
export function teamExportRangeClass(day: string, range: TeamExportWindow | null): string {
  if (!range || day < range.start_date || day > range.end_date) return "";
  return " is-in-range" + (day === range.start_date ? " is-range-start" : "") + (day === range.end_date ? " is-range-end" : "");
}

/** A month's calendar: weeks from Monday, with the days of the months around it as null. */
export function teamExportMonthWeeks(month: string): readonly (readonly (string | null)[])[] {
  const first = monthStart(month);
  const last = monthEnd(month);
  const weeks: (string | null)[][] = [];
  let week: (string | null)[] = Array.from({ length: isoWeekday(first) - 1 }, () => null);
  for (let day = first; day <= last; day = shiftIsoDate(day, 1)) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) weeks.push([...week, ...Array.from({ length: 7 - week.length }, () => null)]);
  return weeks;
}

/** The first day of the month a number of months away. */
export function teamExportShiftMonth(month: string, delta: number): string {
  const [year, value] = month.split("-").map(Number) as [number, number];
  const shifted = new Date(Date.UTC(year, value - 1 + delta, 1));
  return shifted.toISOString().slice(0, 10);
}
