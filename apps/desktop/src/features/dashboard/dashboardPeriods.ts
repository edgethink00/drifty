import { shiftIsoDate } from "@drifty/domain";
import { getCalendarWeekStartDay } from "./weekCalendar";
import { DEFAULT_START_OF_WEEK } from "../settings/settingsStorage";
import type { StartOfWeek } from "../settings/settingsStorage";
import { formatDateRangeLabel, formatDayLabel, getLogicalDayRange, shiftIsoMonth } from "../../lib/formatting";

export type DashboardPeriod = "Today" | "Week" | "Month";

export type ClassificationRange = "Day" | "Week";

export const INSIGHT_RANGE_OPTIONS = [
  { range: "Week", label: "Week", days: 7 },
  { range: "Month", label: "Month", days: 30 },
  { range: "90Day", label: "90 days", days: 90 },
] as const;

export type InsightRange = (typeof INSIGHT_RANGE_OPTIONS)[number]["range"];

const INSIGHT_RANGE_DAYS: Readonly<Record<InsightRange, number>> = {
  Week: 7,
  Month: 30,
  "90Day": 90,
};

export type DashboardPeriodOption = {
  period: DashboardPeriod;
  label: string;
  detail: string;
};

export function getDashboardPeriodRange(selectedDay: string, period: DashboardPeriod, startOfDayMinutes = 0, startOfWeek: StartOfWeek = DEFAULT_START_OF_WEEK) {
  if (period === "Today") {
    return {
      startDay: selectedDay,
      endDay: selectedDay,
      ...getLogicalDayRange(selectedDay, selectedDay, startOfDayMinutes),
    };
  }

  const startDay = period === "Week" ? getCalendarWeekStartDay(selectedDay, startOfWeek) : shiftIsoDate(selectedDay, -29);
  const endDay = period === "Week" ? shiftIsoDate(startDay, 6) : selectedDay;
  return {
    startDay,
    endDay,
    ...getLogicalDayRange(startDay, endDay, startOfDayMinutes),
  };
}

export function getDashboardCurrentPeriodLabel(period: DashboardPeriod): string {
  if (period === "Week") return "This Week";
  if (period === "Month") return "This Month";
  return "Today";
}

export function shiftDashboardPeriodDay(day: string, period: DashboardPeriod, direction: -1 | 1): string {
  if (period === "Week") return shiftIsoDate(day, direction * 7);
  if (period === "Month") return shiftIsoMonth(day, direction);
  return shiftIsoDate(day, direction);
}

export function getSafeClassificationNavigationDay(
  day: string,
  range: ClassificationRange,
  direction: -1 | 0 | 1,
  todayDay: string,
  startOfDayMinutes = 0,
  startOfWeek: StartOfWeek = DEFAULT_START_OF_WEEK,
): string {
  if (direction === 0) return todayDay;

  const targetDay = shiftIsoDate(day, range === "Week" ? direction * 7 : direction);
  if (direction < 0) return targetDay;
  if (range === "Day") return targetDay <= todayDay ? targetDay : todayDay;

  const targetWeekRange = getDashboardPeriodRange(targetDay, "Week", startOfDayMinutes, startOfWeek);
  return targetWeekRange.startDay <= todayDay && todayDay <= targetWeekRange.endDay ? todayDay : targetDay;
}

export function getInsightPeriodRange(selectedDay: string, range: InsightRange = "Week", startOfDayMinutes = 0) {
  const days = INSIGHT_RANGE_DAYS[range];
  const startDay = shiftIsoDate(selectedDay, -(days - 1));
  return {
    startDay,
    endDay: selectedDay,
    ...getLogicalDayRange(startDay, selectedDay, startOfDayMinutes),
  };
}

export function shiftInsightPeriodDay(day: string, range: InsightRange, direction: -1 | 1): string {
  return shiftIsoDate(day, INSIGHT_RANGE_DAYS[range] * direction);
}

export function formatDashboardPeriodLabel(period: DashboardPeriod, startDay: string, endDay: string): string {
  if (period === "Today") return formatDayLabel(endDay);
  return `${period} · ${formatDateRangeLabel(startDay, endDay)}`;
}
