/**
 * Day summaries for the personal API (docs/architecture/personal-api.md).
 *
 * The API reads the account's synced cloud copy, which can hold several
 * computers. Simultaneous time on two computers counts once, exactly as the
 * app's all-device views count it, because both use aggregateDeviceElapsedTime.
 * Productivity and category are the ones the recording computer stored; the
 * person's local category preferences never reach the server.
 *
 * The Supabase Edge runtime consumes a bundled mirror under
 * `apps/desktop/supabase/functions/_shared`; edit this source, then run
 * `npm run sync:personal-api-summary`.
 */
import { isExcludedSegment, isFailedForegroundCaptureSegment, type ActivitySegment } from "./activity";
import { activitySecondsWithinInterval, activityTimeBounds, aggregateDeviceElapsedTime } from "./deviceElapsedTime";

/** One synced record as the API read returns it. */
export type PersonalApiRecord = {
  readonly id: string;
  readonly deviceId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
  readonly appName: string;
  readonly bundleId?: string | null;
  readonly siteDomain?: string | null;
  readonly category?: string | null;
  readonly productivity?: string | null;
  readonly platform?: string | null;
  readonly source?: string | null;
};

export type PersonalApiProductivity = "focus" | "neutral" | "drift" | "unclassified";

export type PersonalApiDayTotals = {
  readonly date: string;
  readonly trackedSeconds: number;
  readonly focusSeconds: number;
  readonly neutralSeconds: number;
  readonly driftSeconds: number;
  readonly unclassifiedSeconds: number;
  /** Focus over tracked time, four decimals; null on a day with no time. */
  readonly focusShare: number | null;
};

export type PersonalApiDaySummary = PersonalApiDayTotals & {
  readonly categories: ReadonlyArray<{ readonly category: string; readonly seconds: number }>;
  readonly apps: ReadonlyArray<{ readonly name: string; readonly seconds: number }>;
  readonly sites: ReadonlyArray<{ readonly domain: string; readonly seconds: number }>;
  /** Computers with time on this day. */
  readonly devices: number;
  /** End of the latest time counted on this day, or null. */
  readonly lastActivityAt: string | null;
};

export const PERSONAL_API_CATEGORIES = [
  "workspace",
  "learning",
  "communication",
  "music",
  "game",
  "social_media",
  "entertainment",
  "shopping",
  "utility",
  "unknown",
] as const;

const BUILT_IN_CATEGORIES = new Set<string>(PERSONAL_API_CATEGORIES);
const PRODUCTIVITY_LABELS = new Set<string>(["focus", "neutral", "drift"]);
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
// Dates the API accepts; also keeps date arithmetic far from Date's limits.
const FIRST_YEAR = 2000;
const LAST_YEAR = 2099;

/** A user-added category leaves the computer only as "custom"; its name stays there. */
export function personalApiCategory(value: string | null | undefined): string {
  if (!value) return "unknown";
  return BUILT_IN_CATEGORIES.has(value) ? value : "custom";
}

export function personalApiProductivity(value: string | null | undefined): PersonalApiProductivity {
  return value && PRODUCTIVITY_LABELS.has(value) ? (value as PersonalApiProductivity) : "unclassified";
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * The IANA name a time zone resolves to ("asia/seoul" → "Asia/Seoul"), or
 * null for an unknown one. Formatters are cached under this name only.
 */
export function canonicalPersonalApiTimeZone(timeZone: string): string | null {
  if (!timeZone || timeZone.length > 64) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isPersonalApiTimeZone(timeZone: string): boolean {
  return canonicalPersonalApiTimeZone(timeZone) !== null;
}

function zonedParts(ms: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const values: Record<string, number> = {};
  for (const part of zoneFormatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Whether value is a real calendar date written YYYY-MM-DD, in 2000–2099. */
export function isPersonalApiDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < FIRST_YEAR || year > LAST_YEAR) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Days from one YYYY-MM-DD date to another; positive when to is later. */
export function personalApiDaysBetween(from: string, to: string): number {
  const start = DATE_PATTERN.exec(from);
  const end = DATE_PATTERN.exec(to);
  if (!start || !end) throw new RangeError("Expected YYYY-MM-DD dates");
  const utc = (match: RegExpExecArray) => Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round((utc(end) - utc(start)) / DAY_MS);
}

export function shiftPersonalApiDate(date: string, days: number): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new RangeError("Expected a YYYY-MM-DD date");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The calendar date at ms in timeZone. */
export function personalApiDateInZone(ms: number, timeZone: string): string {
  const parts = zonedParts(ms, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedMidnight(date: string, timeZone: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new RangeError("Expected a YYYY-MM-DD date");
  const wallClock = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // The two offsets around a change give the candidates for local midnight.
  const first = wallClock - zoneOffsetMs(wallClock, timeZone);
  const second = wallClock - zoneOffsetMs(first, timeZone);
  const candidates = [...new Set([first, second])].sort((a, b) => a - b);
  const isMidnight = (ms: number) => {
    const parts = zonedParts(ms, timeZone);
    return personalApiDateInZone(ms, timeZone) === date && parts.hour === 0 && parts.minute === 0;
  };
  const exact = candidates.find(isMidnight);
  if (exact !== undefined) return exact;
  // Where a DST change skips midnight (Santiago, Havana), the day starts at the
  // first instant of that date, which is the change itself.
  const onDate = candidates.find((ms) => personalApiDateInZone(ms, timeZone) === date);
  return onDate ?? first;
}

/** Local midnight to the next local midnight, as UTC milliseconds. */
export function personalApiDayBounds(date: string, timeZone: string): { start: number; end: number } {
  return { start: zonedMidnight(date, timeZone), end: zonedMidnight(shiftPersonalApiDate(date, 1), timeZone) };
}

/** Records the app leaves out of every total: excluded apps and failed Windows captures. */
function countsTowardTotals(segment: ActivitySegment): boolean {
  return !isExcludedSegment(segment) && !isFailedForegroundCaptureSegment(segment);
}

function toSegment(record: PersonalApiRecord): ActivitySegment {
  return {
    id: record.id,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationSeconds: record.durationSeconds,
    appName: record.appName,
    bundleId: record.bundleId ?? null,
    siteDomain: record.siteDomain ?? null,
    platform: record.platform === "windows" ? "windows" : "macos",
    source: (record.source ?? "unknown") as ActivitySegment["source"],
    deviceId: record.deviceId,
  };
}

function addTo(map: Map<string, number>, key: string, seconds: number): void {
  map.set(key, (map.get(key) ?? 0) + seconds);
}

function ranked<K extends string>(map: Map<string, number>, keyName: K, limit: number): Array<Record<K, string> & { seconds: number }> {
  return [...map.entries()]
    .map(([key, seconds]) => ({ key, seconds: Math.round(seconds) }))
    .filter((entry) => entry.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((entry) => ({ [keyName]: entry.key, seconds: entry.seconds }) as Record<K, string> & { seconds: number });
}

/**
 * One summary per requested date (local midnight to midnight in timeZone).
 * Records must already exclude excluded apps; records from every computer of
 * the account may be passed together.
 */
export function summarizePersonalApiDays(
  records: readonly PersonalApiRecord[],
  options: { readonly dates: readonly string[]; readonly timeZone: string; readonly topLimit?: number },
): PersonalApiDaySummary[] {
  const topLimit = options.topLimit ?? 10;
  const kept = records.map((record) => ({ record, segment: toSegment(record) })).filter((entry) => countsTowardTotals(entry.segment));
  // Same order as kept, so labels below line up by index.
  const segments = aggregateDeviceElapsedTime(kept.map((entry) => entry.segment));
  const bounds = segments.map((segment) => activityTimeBounds(segment));
  return options.dates.map((date) => {
    const window = personalApiDayBounds(date, options.timeZone);
    const productivity = new Map<string, number>();
    const categories = new Map<string, number>();
    const apps = new Map<string, number>();
    const sites = new Map<string, number>();
    const devices = new Set<string>();
    let lastActivityMs: number | null = null;
    segments.forEach((segment, index) => {
      const span = bounds[index];
      if (Math.min(span.end, window.end) <= Math.max(span.start, window.start)) return;
      const seconds = activitySecondsWithinInterval(segment, window.start, window.end);
      if (!(seconds > 0)) return;
      const record = kept[index].record;
      addTo(productivity, personalApiProductivity(record.productivity), seconds);
      addTo(categories, personalApiCategory(record.category), seconds);
      addTo(apps, record.appName, seconds);
      if (record.siteDomain) addTo(sites, record.siteDomain, seconds);
      devices.add(record.deviceId);
      const end = Math.min(span.end, window.end);
      lastActivityMs = lastActivityMs === null ? end : Math.max(lastActivityMs, end);
    });
    const focusSeconds = Math.round(productivity.get("focus") ?? 0);
    const neutralSeconds = Math.round(productivity.get("neutral") ?? 0);
    const driftSeconds = Math.round(productivity.get("drift") ?? 0);
    const unclassifiedSeconds = Math.round(productivity.get("unclassified") ?? 0);
    const trackedSeconds = focusSeconds + neutralSeconds + driftSeconds + unclassifiedSeconds;
    return {
      date,
      trackedSeconds,
      focusSeconds,
      neutralSeconds,
      driftSeconds,
      unclassifiedSeconds,
      focusShare: trackedSeconds > 0 ? Math.round((focusSeconds / trackedSeconds) * 10_000) / 10_000 : null,
      categories: ranked(categories, "category", PERSONAL_API_CATEGORIES.length + 1),
      apps: ranked(apps, "name", topLimit),
      sites: ranked(sites, "domain", topLimit),
      devices: devices.size,
      lastActivityAt: lastActivityMs === null ? null : new Date(lastActivityMs).toISOString(),
    };
  });
}

/** The day totals alone, for a run of days. */
export function personalApiDayTotals(summary: PersonalApiDaySummary): PersonalApiDayTotals {
  return {
    date: summary.date,
    trackedSeconds: summary.trackedSeconds,
    focusSeconds: summary.focusSeconds,
    neutralSeconds: summary.neutralSeconds,
    driftSeconds: summary.driftSeconds,
    unclassifiedSeconds: summary.unclassifiedSeconds,
    focusShare: summary.focusShare,
  };
}
