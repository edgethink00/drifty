import { shiftIsoDate } from "@drifty/domain";

/**
 * The day review used to fire at a fixed 8 PM, borrowed from the leaderboard
 * checkpoint. Someone who closes the laptop at six never saw it. The review
 * time is now the user's own, and a day whose review never got shown is
 * offered once more on the next launch instead of silently disappearing.
 */
export const END_OF_DAY_REVIEW_MINUTE_STORAGE_KEY = "drifty.endOfDayReview.reviewMinute";
export const END_OF_DAY_REVIEW_CATCH_UP_STORAGE_KEY = "drifty.endOfDayReview.catchUpHandledDay";

export const DEFAULT_END_OF_DAY_REVIEW_MINUTE = 20 * 60;

const FIRST_REVIEW_MINUTE = 15 * 60;
const LAST_REVIEW_MINUTE = 23 * 60 + 30;
const REVIEW_STEP_MINUTES = 30;

function formatMinuteValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Half-hour steps from 3 PM to 11:30 PM: earlier reads as a mid-day check, later never gets seen. */
export const END_OF_DAY_REVIEW_MINUTE_OPTIONS: ReadonlyArray<{ value: string; minutes: number }> = Array.from(
  { length: (LAST_REVIEW_MINUTE - FIRST_REVIEW_MINUTE) / REVIEW_STEP_MINUTES + 1 },
  (_, index) => {
    const minutes = FIRST_REVIEW_MINUTE + index * REVIEW_STEP_MINUTES;
    return { value: formatMinuteValue(minutes), minutes };
  },
);

export function endOfDayReviewMinuteToValue(minutes: number): string {
  return formatMinuteValue(snapEndOfDayReviewMinute(minutes));
}

export function endOfDayReviewValueToMinute(value: string): number {
  return END_OF_DAY_REVIEW_MINUTE_OPTIONS.find((option) => option.value === value)?.minutes
    ?? DEFAULT_END_OF_DAY_REVIEW_MINUTE;
}

export function snapEndOfDayReviewMinute(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_END_OF_DAY_REVIEW_MINUTE;
  const snapped = Math.round(minutes / REVIEW_STEP_MINUTES) * REVIEW_STEP_MINUTES;
  return Math.min(LAST_REVIEW_MINUTE, Math.max(FIRST_REVIEW_MINUTE, snapped));
}

export function resolveInitialEndOfDayReviewMinute(storage = browserStorage()): number {
  if (!storage) return DEFAULT_END_OF_DAY_REVIEW_MINUTE;
  const saved = storage.getItem(END_OF_DAY_REVIEW_MINUTE_STORAGE_KEY);
  if (saved === null || saved === "") return DEFAULT_END_OF_DAY_REVIEW_MINUTE;
  return snapEndOfDayReviewMinute(Number(saved));
}

export function persistEndOfDayReviewMinute(minutes: number, storage = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(END_OF_DAY_REVIEW_MINUTE_STORAGE_KEY, String(snapEndOfDayReviewMinute(minutes)));
  } catch {
    // Losing the preference falls back to the default; it must not block the review itself.
  }
}

/**
 * The review minute is a wall-clock time while "today" is a logical day that
 * may start at 4 AM. A review set for 8 PM is due from 8 PM until the logical
 * day rolls over; between midnight and the day start the clock reads earlier
 * than the review minute even though the same logical day continues.
 */
export function isEndOfDayReviewDue(
  currentMinuteOfDay: number,
  reviewMinute: number,
  startOfDayMinutes: number,
): boolean {
  if (currentMinuteOfDay >= reviewMinute) return true;
  return startOfDayMinutes > 0 && currentMinuteOfDay < startOfDayMinutes && reviewMinute >= startOfDayMinutes;
}

export type EndOfDayReviewCatchUp = {
  readonly day: string;
};

/**
 * One chance, for yesterday only. A review of a day before that is history,
 * and the dashboard is the place for history. The catch-up marker is
 * per-day, so a launch that decides against showing it (thin day) still
 * closes that day rather than re-checking on every later launch.
 */
export function resolveEndOfDayReviewCatchUp(input: {
  readonly todayDay: string;
  readonly lastShownDay: string | null;
  readonly catchUpHandledDay: string | null;
}): EndOfDayReviewCatchUp | null {
  const yesterday = shiftIsoDate(input.todayDay, -1);
  if (input.lastShownDay === yesterday) return null;
  if (input.catchUpHandledDay === yesterday) return null;
  return { day: yesterday };
}

export function readEndOfDayReviewCatchUpHandledDay(storage = browserStorage()): string | null {
  if (!storage) return null;
  const value = storage.getItem(END_OF_DAY_REVIEW_CATCH_UP_STORAGE_KEY);
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function persistEndOfDayReviewCatchUpHandledDay(day: string, storage = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(END_OF_DAY_REVIEW_CATCH_UP_STORAGE_KEY, day);
  } catch {
    // A repeated catch-up card is a nuisance, not a failure.
  }
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}
