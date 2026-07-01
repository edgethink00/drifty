import { logicalDayEndExclusiveMs, logicalDayIsoDateForDate, logicalDayStartMs, shiftIsoDate } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function weekdayOrderIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

// Average focus/drift/neutral and per-category seconds for a typical occurrence
// of each weekday across the insight window. Segments are attributed by their
// local start time; captures are short, so midnight spanning is negligible.

export function getLocalDaysBetween(startMs: number, endMs: number): string[] {
  const days: string[] = [];
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);

  while (cursor.getTime() < endMs) {
    const day = isoDateFromTimestamp(cursor.toISOString());
    if (day) days.push(day);
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < items.length; i += size) r.push(items.slice(i, i + size));
  return r;
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatCompactDurationFromSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0";
  const h = Math.floor(totalSeconds / 3600), m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatTimeLabel(value: string | Date): string {
  return uiTimeFormatter.format(typeof value === "string" ? new Date(value) : value);
}

export function formatRelativeTime(value: string): string {
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return "unknown";

  const diffSeconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
  if (diffSeconds < 10) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;

  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatQuarterHourLabel(minuteOfDay: number): string {
  const normalized = ((minuteOfDay % (24 * 60)) + (24 * 60)) % (24 * 60);
  const date = new Date(2026, 0, 1, Math.floor(normalized / 60), normalized % 60, 0, 0);
  return uiTimeFormatter.format(date);
}

export function describeRelativeDay(day: string, startOfDayMinutes = 0): string {
  const today = logicalTodayIsoDate(startOfDayMinutes);
  if (day === today) return "Today";
  if (day === shiftIsoDate(today, -1)) return "Yesterday";
  if (day === shiftIsoDate(today, 1)) return "Tomorrow";
  return "Selected day";
}

export function buildIsoDayList(startDay: string, endDay: string): string[] {
  const days: string[] = [];
  let cursor = startDay;
  while (cursor <= endDay) {
    days.push(cursor);
    cursor = shiftIsoDate(cursor, 1);
  }
  return days;
}

export function formatCalendarMinuteLabel(day: string, minuteOfDay: number, startOfDayMinutes = 0): string {
  return formatTimeLabel(new Date(logicalDayStartMs(day, startOfDayMinutes) + minuteOfDay * 60 * 1000));
}

export function formatCompactHourLabel(hour: number): string {
  const normalizedHour = ((Math.floor(hour) % 24) + 24) % 24;
  const period = normalizedHour < 12 ? "am" : "pm";
  const displayHour = normalizedHour % 12 || 12;
  return `${displayHour}${period}`;
}

export function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

export function shiftIsoMonth(day: string, direction: -1 | 1): string {
  const [yearValue, monthValue, dayValue] = day.split("-").map(Number);
  const targetMonthIndex = monthValue - 1 + direction;
  const targetYear = yearValue + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, normalizedMonthIndex + 1, 0).getDate();
  const targetDay = Math.min(dayValue, daysInTargetMonth);
  return `${targetYear}-${String(normalizedMonthIndex + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function getLogicalDayRange(startDay: string, endDay: string, startOfDayMinutes = 0): { start: string; end: string } {
  return {
    start: formatLocalDateTime(logicalDayStartMs(startDay, startOfDayMinutes)),
    end: formatLocalDateTime(logicalDayEndExclusiveMs(endDay, startOfDayMinutes) - 1),
  };
}

export function formatLocalDateTime(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

export function logicalTodayIsoDate(startOfDayMinutes = 0): string {
  return logicalDayIsoDateForDate(new Date(), startOfDayMinutes);
}

export function clockHourForLogicalHour(logicalHour: number, startOfDayMinutes = 0): number {
  return Math.floor((logicalHour * 60 + startOfDayMinutes) / 60) % 24;
}

export function formatStartOfDayOptionLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${period}`;
}

export function filterSegmentsForRange(segments: ActivitySegment[], start: string, end: string): ActivitySegment[] {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();

  return segments.filter((segment) => {
    const segmentStart = new Date(segment.startedAt).getTime();
    const segmentEnd = new Date(segment.endedAt).getTime();
    return segmentEnd >= startMs && segmentStart <= endMs;
  });
}

export function formatDateRangeLabel(startDay: string, endDay: string): string {
  if (startDay === endDay) return formatDayLabel(endDay);
  return `${formatDayLabel(startDay)}–${formatDayLabel(endDay)}`;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "Unknown error"; }
}

export function formatDayLabel(day: string): string {
  const parsed = new Date(`${day}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return day;
  return uiDayFormatter.format(parsed);
}

export function formatHistoryMonthLabel(month: string): string {
  const parsed = new Date(`${month}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return month;
  return new Intl.DateTimeFormat(UI_LOCALE, { month: "long", year: "numeric" }).format(parsed);
}

export function isoDateFromTimestamp(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${`${parsed.getMonth() + 1}`.padStart(2, "0")}-${`${parsed.getDate()}`.padStart(2, "0")}`;
}

export function createLocalId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export const UI_LOCALE = "en-US";

export const uiDayFormatter = new Intl.DateTimeFormat(UI_LOCALE, { weekday: "short", month: "short", day: "numeric" });

export const uiTimeFormatter = new Intl.DateTimeFormat(UI_LOCALE, { hour: "numeric", minute: "2-digit" });
