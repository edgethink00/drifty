import { TEAM_LOCAL_TIMEZONE, type TeamRecordingSchedule, type TeamTrackingPolicy } from "./teamSharingScope";

/**
 * Managed tracking (owner decision 2026-10-17): a member of a managed team
 * cannot pause during the team's recording hours. The app turns each such
 * team's hours into spans of real time for the weeks ahead, so the native
 * side can refuse a pause from any menu without reading time zones, and the
 * spans follow daylight saving as the hours' clock does. Leaders are not held
 * to it: the policy names members.
 */
export type TeamManagedHoursSource = {
  readonly teamName: string;
  readonly policy: TeamTrackingPolicy | null | undefined;
  readonly seat: "admin" | "manager" | "member" | null;
  readonly schedule: TeamRecordingSchedule | null | undefined;
};

/** One span of time when pausing is off, in Unix seconds, with the team that holds it. */
export type TeamPauseLockSpan = { readonly teamName: string; readonly startsAt: number; readonly endsAt: number };

export const TEAM_PAUSE_LOCK_DAYS = 21;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The wall-clock parts of an instant in a time zone ("local" is this computer's clock). */
function wallClock(instantMs: number, timeZone: string): { readonly year: number; readonly month: number; readonly day: number; readonly hour: number; readonly minute: number; readonly weekday: number } {
  if (timeZone === TEAM_LOCAL_TIMEZONE) {
    const date = new Date(instantMs);
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), weekday: ((date.getDay() + 6) % 7) + 1 };
  }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" }).formatToParts(new Date(instantMs));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return { year: Number(part("year")), month: Number(part("month")), day: Number(part("day")), hour: Number(part("hour")) % 24, minute: Number(part("minute")), weekday: weekdays.indexOf(part("weekday")) + 1 };
}

/** The instant a wall-clock time in a time zone falls on; in a skipped hour, the first instant after it. */
function instantOf(year: number, month: number, day: number, minuteOfDay: number, timeZone: string): number {
  if (timeZone === TEAM_LOCAL_TIMEZONE) return new Date(year, month - 1, day, 0, minuteOfDay).getTime();
  const wanted = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  let guess = wanted;
  // Two corrections settle any offset, including across a daylight-saving change.
  for (let step = 0; step < 2; step += 1) {
    const seen = wallClock(guess, timeZone);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += wanted - seenAsUtc;
  }
  return guess;
}

function validZone(timeZone: string): boolean {
  if (timeZone === TEAM_LOCAL_TIMEZONE) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The spans, from now for the days ahead, when a member of a managed team cannot pause. */
export function teamPauseLockSpans(sources: readonly TeamManagedHoursSource[], nowMs: number, days = TEAM_PAUSE_LOCK_DAYS): TeamPauseLockSpan[] {
  const spans: TeamPauseLockSpan[] = [];
  for (const source of sources) {
    if (source.policy !== "managed" || source.seat !== "member" || !source.schedule) continue;
    const { start_minute: start, end_minute: end, days: weekdays } = source.schedule;
    if (!(start < end) || weekdays.length === 0) continue;
    const zone = validZone(source.schedule.timezone) ? source.schedule.timezone : TEAM_LOCAL_TIMEZONE;
    // Walk the hours' own calendar days, starting the day before so a span already under way is kept.
    for (let offset = -1; offset <= days; offset += 1) {
      const day = wallClock(nowMs + offset * DAY_MS, zone);
      if (!weekdays.includes(day.weekday)) continue;
      const startsAt = instantOf(day.year, day.month, day.day, start, zone);
      const endsAt = instantOf(day.year, day.month, day.day, end, zone);
      if (endsAt <= nowMs || endsAt <= startsAt) continue;
      spans.push({ teamName: source.teamName, startsAt: Math.floor(startsAt / 1000), endsAt: Math.floor(endsAt / 1000) });
    }
  }
  const seen = new Set<string>();
  return spans
    .filter((span) => {
      const key = span.teamName + ":" + String(span.startsAt);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.startsAt - right.startsAt);
}

/** The span holding now, if any: the team keeping tracking on and when its hours end. */
export function activeTeamPauseLock(spans: readonly TeamPauseLockSpan[], nowMs: number): TeamPauseLockSpan | null {
  const now = nowMs / 1000;
  let found: TeamPauseLockSpan | null = null;
  for (const span of spans) {
    if (span.startsAt <= now && now < span.endsAt && (!found || span.endsAt > found.endsAt)) found = span;
  }
  return found;
}

/** Minutes until a lock span ends, rounded up, for "until 18:00" style copy and refresh timing. */
export function minutesUntil(epochSeconds: number, nowMs: number): number {
  return Math.max(0, Math.ceil((epochSeconds * 1000 - nowMs) / MINUTE_MS));
}

