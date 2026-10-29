import { defaultLocaleForLanguage } from "../features/localization/languageCatalog";
import { localeCopy } from "../features/localization/localeCopy";
import { logicalDayEndExclusiveMs, logicalDayIsoDateForDate, logicalDayStartMs, sampledActivityTimeBounds, shiftIsoDate } from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";
import type { DisplayLanguage } from "../features/localization/languagePreference";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Keep the device region for a manual Spanish choice when no Spanish variant is configured. */
export function localeForDisplayLanguage(language: DisplayLanguage): string {
  if (language === "ko") return "ko-KR";
  if (language === "es") {
    const preferred = typeof navigator === "undefined" ? "" : navigator.languages?.find((value) => /^es(?:[-_]|$)/iu.test(value)) ?? "";
    if (preferred) return preferred.replace("_", "-");
    const systemLocale = typeof navigator === "undefined" ? "" : navigator.language || Intl.DateTimeFormat().resolvedOptions().locale;
    const region = /(?:-|_)([a-z]{2}|\d{3})(?:-|$)/iu.exec(systemLocale)?.[1];
    return region ? `es-${region.toUpperCase()}` : "es";
  }
  if (language === "fr" || language === "de") {
    const preferred = typeof navigator === "undefined" ? undefined : navigator.languages?.find((tag) => tag.toLowerCase().startsWith(`${language}-`));
    if (preferred) return preferred.replace("_", "-");
  }
  return defaultLocaleForLanguage(language);
}

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
  if (language !== "ko" && language !== "es") {
    const unit = (value: number, name: "hour" | "minute") => new Intl.NumberFormat(localeForDisplayLanguage(language), {
      style: "unit", unit: name, unitDisplay: "short", maximumFractionDigits: 0,
    }).format(value);
    if (hours === 0) return unit(minutes, "minute");
    if (minutes === 0) return unit(hours, "hour");
    return `${unit(hours, "hour")} ${unit(minutes, "minute")}`;
  }
  if (language === "es") {
    if (hours === 0) return `${minutes} min`;
    if (minutes === 0) return `${hours} h`;
    return `${hours} h ${minutes} min`;
  }
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
  if (language !== "ko") return new Intl.DateTimeFormat(localeForDisplayLanguage(language), { hour: "numeric", minute: "2-digit" })
    .format(typeof value === "string" ? new Date(value) : value);
  return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true })
    .format(typeof value === "string" ? new Date(value) : value);
}

/**
 * Start–end time on one line without repeating the meridiem: "오전 1:41 – 1:48",
 * "1:41 – 1:48 AM". Collapses to a single time when both ends land on the same
 * displayed minute, which minute-precision capture slices hit constantly.
 */
export function formatLocalizedCompactTimeRange(
  startedAt: string | Date,
  endedAt: string | Date,
  language: DisplayLanguage,
): string {
  const start = typeof startedAt === "string" ? new Date(startedAt) : startedAt;
  const end = typeof endedAt === "string" ? new Date(endedAt) : endedAt;
  if (language !== "en" && language !== "ko") {
    const formatter = new Intl.DateTimeFormat(localeForDisplayLanguage(language), { hour: "numeric", minute: "2-digit" });
    if (Math.floor(start.getTime() / 60_000) === Math.floor(end.getTime() / 60_000)) return formatter.format(start);
    return formatIntlRange(formatter, start, end);
  }
  const partsOf = (date: Date) => {
    const minutes = date.getHours() * 60 + date.getMinutes();
    const hour12 = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
    const time = `${hour12}:${String(date.getMinutes()).padStart(2, "0")}`;
    const ampm = date.getHours() < 12
      ? (language === "en" ? "AM" : "오전")
      : (language === "en" ? "PM" : "오후");
    return { minutes, time, ampm };
  };
  const s = partsOf(start);
  const e = partsOf(end);
  const join = (time: string, ampm: string) => (language === "en" ? `${time} ${ampm}` : `${ampm} ${time}`);
  if (s.ampm === e.ampm && s.minutes === e.minutes) return join(s.time, s.ampm);
  if (s.ampm === e.ampm) return language === "en" ? `${s.time} – ${e.time} ${s.ampm}` : `${s.ampm} ${s.time} – ${e.time}`;
  return `${join(s.time, s.ampm)} – ${join(e.time, e.ampm)}`;
}

/**
 * Sub-minute durations read as seconds ("54초", "54s") because minute-rounding
 * would print them as 0; anything longer keeps the compact minute format.
 */
export function formatLocalizedShortDurationFromSeconds(totalSeconds: number, language: DisplayLanguage): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) {
    if (language === "en") return `${seconds}s`;
    if (language === "ko") return `${seconds}초`;
    return new Intl.NumberFormat(localeForDisplayLanguage(language), { style: "unit", unit: "second", unitDisplay: "short" }).format(seconds);
  }
  return formatLocalizedCompactDurationFromSeconds(totalSeconds, language);
}

export function formatRelativeTime(value: string, locale = "en-US"): string {
  const parsed = new Date(value).getTime();
  const isKorean = locale.toLowerCase().startsWith("ko");
  const isSpanish = locale.toLowerCase().startsWith("es");
  if (!isKorean && !isSpanish && !locale.toLowerCase().startsWith("en")) {
    if (Number.isNaN(parsed)) {
      const language = locale.startsWith("ja") ? "ja" : locale.startsWith("pt") ? "pt-BR" : locale.startsWith("zh") ? "zh-Hans" : locale.startsWith("fr") ? "fr" : "de";
      return localeCopy(language, "unknown");
    }
    const seconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    if (seconds < 10) return relative.format(0, "second");
    if (seconds < 60) return relative.format(-seconds, "second");
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return relative.format(-minutes, "minute");
    const hours = Math.round(minutes / 60);
    return hours < 24 ? relative.format(-hours, "hour") : relative.format(-Math.round(hours / 24), "day");
  }
  if (Number.isNaN(parsed)) return isKorean ? "알 수 없음" : isSpanish ? "desconocido" : "unknown";

  const diffSeconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
  if (diffSeconds < 10) return isKorean ? "방금" : isSpanish ? "ahora mismo" : "just now";
  if (diffSeconds < 60) return isKorean ? `${diffSeconds}초 전` : isSpanish ? `hace ${diffSeconds} s` : `${diffSeconds}s ago`;

  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return isKorean ? `${diffMinutes}분 전` : isSpanish ? `hace ${diffMinutes} min` : `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return isKorean ? `${diffHours}시간 전` : isSpanish ? `hace ${diffHours} h` : `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return isKorean ? `${diffDays}일 전` : isSpanish ? `hace ${diffDays} d` : `${diffDays}d ago`;
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
  if (language !== "ko" && language !== "es") {
    if (label === "Selected day") return localeCopy(language, "selectedDay");
    return new Intl.RelativeTimeFormat(localeForDisplayLanguage(language), { numeric: "auto" }).format(label === "Today" ? 0 : label === "Yesterday" ? -1 : 1, "day");
  }
  if (language === "es") {
    if (label === "Today") return "Hoy";
    if (label === "Yesterday") return "Ayer";
    if (label === "Tomorrow") return "Mañana";
    return "Día seleccionado";
  }
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
  void day;
  const clockMinute = ((startOfDayMinutes + minuteOfDay) % (24 * 60) + 24 * 60) % (24 * 60);
  const clock = new Date(Date.UTC(2000, 0, 1, 0, clockMinute));
  return new Intl.DateTimeFormat(UI_LOCALE, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(clock);
}

export function formatLocalizedCalendarMinuteLabel(
  day: string,
  minuteOfDay: number,
  language: DisplayLanguage,
  startOfDayMinutes = 0,
): string {
  void day;
  const clockMinute = ((startOfDayMinutes + minuteOfDay) % (24 * 60) + 24 * 60) % (24 * 60);
  const clock = new Date(Date.UTC(2000, 0, 1, 0, clockMinute));
  if (language !== "en" && language !== "ko") {
    return new Intl.DateTimeFormat(localeForDisplayLanguage(language), {
      hour: "numeric", minute: "2-digit", timeZone: "UTC",
    }).format(clock);
  }
  return new Intl.DateTimeFormat(language === "en" ? UI_LOCALE : "ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(clock);
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
  if (language === "ko") return `${normalizedHour}시`;
  if (language === "es") return `${normalizedHour} h`;
  // Compact chart rails are 2rem wide: "13 Uhr" and "下午1时" clip the
  // hour itself. Keep these axes unambiguous with short 24-hour labels.
  if (language === "de") return String(normalizedHour);
  if (language === "zh-Hans") return `${normalizedHour}时`;
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), { hour: "numeric" }).format(new Date(2000, 0, 1, normalizedHour));
}

export function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

export function formatLocalizedHourLabel(hour: number, language: DisplayLanguage): string {
  if (language === "en") return formatHourLabel(hour);
  const normalizedHour = ((Math.floor(hour) % 24) + 24) % 24;
  if (language === "ko") return `${normalizedHour}시`;
  if (language === "es") return `${String(normalizedHour).padStart(2, "0")}:00`;
  return formatLocalizedTimeLabel(new Date(2000, 0, 1, normalizedHour), language);
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
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", ...(/^(en|ko)(-|$)/iu.test(locale) ? { hour12: true } : {}) }).format(date);
}

/** The device's IANA time zone with its current UTC offset, e.g. "Asia/Seoul · GMT+9". */
export function formatDeviceTimeZone(now = new Date()): string {
  let zone = "UTC";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return zone;
  }
  try {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value;
    return offset ? zone + " · " + offset : zone;
  } catch {
    // An engine without shortOffset still knows the zone name; show it alone.
    return zone;
  }
}

export function filterSegmentsForRange(
  segments: readonly ActivitySegment[],
  start: string,
  end: string,
  clipWindow?: { readonly start: number; readonly end: number },
): ActivitySegment[] {
  // Generic callers keep exact inclusive endpoints. Summary callers supply
  // their real half-open logical window, including the final query second.
  const startMs = clipWindow?.start ?? Date.parse(start);
  const endMs = clipWindow?.end ?? Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];

  return segments.filter((segment) => {
    const rawStart = Date.parse(segment.startedAt);
    const rawEnd = Date.parse(segment.endedAt);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd < rawStart) return false;
    const { start: segmentStart, end: segmentEnd } = sampledActivityTimeBounds(segment);
    return segmentEnd >= startMs && (clipWindow ? segmentStart < endMs : segmentStart <= endMs);
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
  const locale = localeForDisplayLanguage(language);
  if (language !== "es" && language !== "ko") {
    return formatIntlRange(new Intl.DateTimeFormat(locale, { year: sameYear ? undefined : "numeric", month: "short", day: "numeric" }), start, end);
  }
  if (language === "es" && sameMonth) {
    const month = new Intl.DateTimeFormat(locale, { month: "long" }).format(start);
    return `${start.getDate()}–${end.getDate()} de ${month}`;
  }
  const startLabel = new Intl.DateTimeFormat(locale, sameYear
    ? { month: "long", day: "numeric" }
    : { year: "numeric", month: "long", day: "numeric" }).format(start);
  const endLabel = new Intl.DateTimeFormat(locale, sameMonth
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
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), { weekday: "short", month: "long", day: "numeric" }).format(parsed);
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

export function parseLocalIsoDay(day: string): Date | null {
  const parsed = new Date(`${day}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Older WebViews retain a readable range when Intl.formatRange is unavailable. */
export function formatIntlRange(formatter: Intl.DateTimeFormat, start: Date, end: Date): string {
  const rangeFormatter = formatter as Intl.DateTimeFormat & { formatRange?: (start: Date, end: Date) => string };
  return rangeFormatter.formatRange ? rangeFormatter.formatRange(start, end) : `${formatter.format(start)} – ${formatter.format(end)}`;
}
