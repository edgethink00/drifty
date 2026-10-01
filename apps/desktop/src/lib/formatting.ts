import { logicalDayEndExclusiveMs, logicalDayIsoDateForDate, logicalDayStartMs, shiftIsoDate } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";
import type { DisplayLanguage } from "../features/localization/languagePreference";

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

export { secondsToLabel as formatDuration } from "@drifty/domain";

export function formatRoundedDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  // Round once at minute precision so 59.5 minutes carries into the hour.
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatCompactDurationFromSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0";
  const totalMinutes = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60), m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatLocalizedDuration(totalSeconds: number, language: DisplayLanguage): string {
  if (language === "en") return formatRoundedDuration(totalSeconds);
  const totalMinutes = Math.max(0, Math.round(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

export function formatLocalizedCompactDurationFromSeconds(totalSeconds: number, language: DisplayLanguage): string {
  if (language === "en") return formatCompactDurationFromSeconds(totalSeconds);
  return formatLocalizedDuration(totalSeconds, language);
}

export function formatTimeLabel(value: string | Date): string {
  return uiTimeFormatter.format(typeof value === "string" ? new Date(value) : value);
}

export function formatLocalizedTimeLabel(value: string | Date, language: DisplayLanguage): string {
  if (language === "en") return formatTimeLabel(value);
  return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true })
    .format(typeof value === "string" ? new Date(value) : value);
}

export function formatRelativeTime(value: string, locale = "en-US"): string {
  const parsed = new Date(value).getTime();
  const isKorean = locale.toLowerCase().startsWith("ko");
  if (Number.isNaN(parsed)) return isKorean ? "알 수 없음" : "unknown";

  const diffSeconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
  if (diffSeconds < 10) return isKorean ? "방금" : "just now";
  if (diffSeconds < 60) return isKorean ? `${diffSeconds}초 전` : `${diffSeconds}s ago`;

  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return isKorean ? `${diffMinutes}분 전` : `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return isKorean ? `${diffHours}시간 전` : `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return isKorean ? `${diffDays}일 전` : `${diffDays}d ago`;
}

export function formatQuarterHourLabel(minuteOfDay: number): string {
  const normalized = ((minuteOfDay % (24 * 60)) + (24 * 60)) % (24 * 60);
  const date = new Date(2026, 0, 1, Math.floor(normalized / 60), normalized % 60, 0, 0);
  return uiTimeFormatter.format(date);
}

export function formatLocalizedQuarterHourLabel(minuteOfDay: number, language: DisplayLanguage): string {
  if (language === "en") return formatQuarterHourLabel(minuteOfDay);
  const normalized = ((minuteOfDay % (24 * 60)) + (24 * 60)) % (24 * 60);
  const date = new Date(2026, 0, 1, Math.floor(normalized / 60), normalized % 60, 0, 0);
  return formatLocalizedTimeLabel(date, language);
}

export function describeRelativeDay(day: string, startOfDayMinutes = 0): string {
  const today = logicalTodayIsoDate(startOfDayMinutes);
  if (day === today) return "Today";
  if (day === shiftIsoDate(today, -1)) return "Yesterday";
  if (day === shiftIsoDate(today, 1)) return "Tomorrow";
  return "Selected day";
}

export function describeLocalizedRelativeDay(
  day: string,
  language: DisplayLanguage,
  startOfDayMinutes = 0,
): string {
  const label = describeRelativeDay(day, startOfDayMinutes);
  if (language === "en") return label;
  if (label === "Today") return "오늘";
  if (label === "Yesterday") return "어제";
  if (label === "Tomorrow") return "내일";
  return "선택한 날짜";
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

export function formatLocalizedCalendarMinuteLabel(
  day: string,
  minuteOfDay: number,
  language: DisplayLanguage,
  startOfDayMinutes = 0,
): string {
  return formatLocalizedTimeLabel(
    new Date(logicalDayStartMs(day, startOfDayMinutes) + minuteOfDay * 60 * 1000),
    language,
  );
}

export function formatCompactHourLabel(hour: number): string {
  const normalizedHour = ((Math.floor(hour) % 24) + 24) % 24;
  const period = normalizedHour < 12 ? "am" : "pm";
  const displayHour = normalizedHour % 12 || 12;
  return `${displayHour}${period}`;
}

export function formatLocalizedCompactHourLabel(hour: number, language: DisplayLanguage): string {
  if (language === "en") return formatCompactHourLabel(hour);
  const normalizedHour = ((Math.floor(hour) % 24) + 24) % 24;
  return `${normalizedHour}시`;
}

export function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

export function formatLocalizedHourLabel(hour: number, language: DisplayLanguage): string {
  if (language === "en") return formatHourLabel(hour);
  const normalizedHour = ((Math.floor(hour) % 24) + 24) % 24;
  return `${normalizedHour}시`;
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

export function formatStartOfDayOptionLabel(minutes: number, locale = UI_LOCALE): string {
  const normalized = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const date = new Date(2026, 0, 1, Math.floor(normalized / 60), normalized % 60, 0, 0);
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

export function filterSegmentsForRange(segments: ActivitySegment[], start: string, end: string): ActivitySegment[] {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  return segments.filter((segment) => {
    const segmentStart = Date.parse(segment.startedAt);
    const segmentEnd = Date.parse(segment.endedAt);
    return segmentEnd >= startMs && segmentStart <= endMs;
  });
}

export function formatDateRangeLabel(startDay: string, endDay: string): string {
  if (startDay === endDay) return formatDayLabel(endDay);
  const start = parseLocalIsoDay(startDay);
  const end = parseLocalIsoDay(endDay);
  if (!start || !end) return `${startDay}–${endDay}`;

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const startLabel = new Intl.DateTimeFormat(UI_LOCALE, sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" }).format(start);
  const endLabel = new Intl.DateTimeFormat(UI_LOCALE, sameMonth
    ? { day: "numeric" }
    : sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" }).format(end);
  return `${startLabel}–${endLabel}`;
}

export function formatLocalizedDateRangeLabel(
  startDay: string,
  endDay: string,
  language: DisplayLanguage,
): string {
  if (language === "en") return formatDateRangeLabel(startDay, endDay);
  if (startDay === endDay) return formatLocalizedDayLabel(endDay, language);
  const start = parseLocalIsoDay(startDay);
  const end = parseLocalIsoDay(endDay);
  if (!start || !end) return `${startDay}–${endDay}`;

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const startLabel = new Intl.DateTimeFormat("ko-KR", sameYear
    ? { month: "long", day: "numeric" }
    : { year: "numeric", month: "long", day: "numeric" }).format(start);
  const endLabel = new Intl.DateTimeFormat("ko-KR", sameMonth
    ? { day: "numeric" }
    : sameYear
      ? { month: "long", day: "numeric" }
      : { year: "numeric", month: "long", day: "numeric" }).format(end);
  return `${startLabel}–${endLabel}`;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "Unknown error"; }
}

export function formatDayLabel(day: string): string {
  const parsed = parseLocalIsoDay(day);
  if (!parsed) return day;
  return uiDayFormatter.format(parsed);
}

export function formatLocalizedDayLabel(day: string, language: DisplayLanguage): string {
  if (language === "en") return formatDayLabel(day);
  const parsed = parseLocalIsoDay(day);
  if (!parsed) return day;
  return new Intl.DateTimeFormat("ko-KR", { weekday: "short", month: "long", day: "numeric" }).format(parsed);
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

function parseLocalIsoDay(day: string): Date | null {
  const parsed = new Date(`${day}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
