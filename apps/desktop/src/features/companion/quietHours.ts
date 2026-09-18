import { useEffect, useState } from "react";

/**
 * Quiet hours pause interventions and celebrations for a daily window while
 * leaving tracking and the Day Review alone. The window is wall-clock time and
 * may cross midnight (22:00–08:00).
 */
export const QUIET_HOURS_STORAGE_KEY = "drifty.notifications.quietHours.v1";

export type QuietHoursSettings = {
  readonly enabled: boolean;
  readonly startMinute: number;
  readonly endMinute: number;
};

const MINUTES_PER_DAY = 24 * 60;
const QUIET_HOURS_STEP_MINUTES = 30;

export const DEFAULT_QUIET_HOURS: QuietHoursSettings = {
  enabled: false,
  startMinute: 22 * 60,
  endMinute: 8 * 60,
};

/** Half-hour steps across the day, as "HH:MM" values for the settings selects. */
export const QUIET_HOURS_MINUTE_OPTIONS: ReadonlyArray<{ value: string; minutes: number }> = Array.from(
  { length: MINUTES_PER_DAY / QUIET_HOURS_STEP_MINUTES },
  (_, index) => {
    const minutes = index * QUIET_HOURS_STEP_MINUTES;
    return { value: quietHoursMinuteToValue(minutes), minutes };
  },
);

export function quietHoursMinuteToValue(minutes: number): string {
  const snapped = snapQuietHoursMinute(minutes);
  return `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`;
}

export function quietHoursValueToMinute(value: string, fallback: number): number {
  return QUIET_HOURS_MINUTE_OPTIONS.find((option) => option.value === value)?.minutes ?? fallback;
}

export function snapQuietHoursMinute(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  const snapped = Math.round(minutes / QUIET_HOURS_STEP_MINUTES) * QUIET_HOURS_STEP_MINUTES;
  return ((snapped % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Start and end are kept distinct: an equal pair would read as either "never"
 * or "always", and neither is what someone picking two times means. The end
 * moves one step later so the window stays visible.
 */
export function normalizeQuietHours(value: Partial<QuietHoursSettings> | null | undefined): QuietHoursSettings {
  const startMinute = snapQuietHoursMinute(typeof value?.startMinute === "number" ? value.startMinute : DEFAULT_QUIET_HOURS.startMinute);
  let endMinute = snapQuietHoursMinute(typeof value?.endMinute === "number" ? value.endMinute : DEFAULT_QUIET_HOURS.endMinute);
  if (endMinute === startMinute) endMinute = (startMinute + QUIET_HOURS_STEP_MINUTES) % MINUTES_PER_DAY;
  return {
    enabled: value?.enabled === true,
    startMinute,
    endMinute,
  };
}

export function isWithinQuietHours(minuteOfDay: number, settings: QuietHoursSettings): boolean {
  if (!settings.enabled) return false;
  const minute = ((Math.floor(minuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const { startMinute, endMinute } = settings;
  if (startMinute === endMinute) return false;
  if (startMinute < endMinute) return minute >= startMinute && minute < endMinute;
  // Crosses midnight: quiet from start until the day ends, then until end.
  return minute >= startMinute || minute < endMinute;
}

export function minuteOfDayFromDate(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function isQuietHoursActiveAt(date: Date, settings: QuietHoursSettings): boolean {
  return isWithinQuietHours(minuteOfDayFromDate(date), settings);
}

/** Milliseconds until the window next opens or closes, for scheduling a re-check. */
export function millisecondsUntilNextQuietHoursBoundary(date: Date, settings: QuietHoursSettings): number {
  const currentMinute = minuteOfDayFromDate(date);
  const secondsIntoMinute = date.getSeconds() + date.getMilliseconds() / 1000;
  const candidates = [settings.startMinute, settings.endMinute]
    .map((boundary) => ((boundary - currentMinute) + MINUTES_PER_DAY) % MINUTES_PER_DAY)
    .map((deltaMinutes) => (deltaMinutes === 0 ? MINUTES_PER_DAY : deltaMinutes));
  const deltaMinutes = Math.min(...candidates);
  return Math.max(1_000, Math.round((deltaMinutes * 60 - secondsIntoMinute) * 1000));
}

export function resolveInitialQuietHours(): QuietHoursSettings {
  if (typeof window === "undefined") return DEFAULT_QUIET_HOURS;
  try {
    const raw = window.localStorage.getItem(QUIET_HOURS_STORAGE_KEY);
    if (!raw) return DEFAULT_QUIET_HOURS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_QUIET_HOURS;
    return normalizeQuietHours(parsed as Partial<QuietHoursSettings>);
  } catch {
    return DEFAULT_QUIET_HOURS;
  }
}

export function persistQuietHours(settings: QuietHoursSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUIET_HOURS_STORAGE_KEY, JSON.stringify(normalizeQuietHours(settings)));
  } catch {
    // Losing the preference falls back to the default; it must not block delivery.
  }
}

/**
 * Whether the window is open right now, re-evaluated at each boundary so
 * gates that read it from render (celebrations) flip without a poll.
 */
export function useQuietHoursActive(settings: QuietHoursSettings): boolean {
  const [active, setActive] = useState(() => isQuietHoursActiveAt(new Date(), settings));

  useEffect(() => {
    if (!settings.enabled) {
      setActive(false);
      return undefined;
    }
    let timer = 0;
    const evaluate = () => {
      const now = new Date();
      setActive(isQuietHoursActiveAt(now, settings));
      timer = window.setTimeout(evaluate, millisecondsUntilNextQuietHoursBoundary(now, settings));
    };
    evaluate();
    return () => window.clearTimeout(timer);
  }, [settings]);

  return active;
}

