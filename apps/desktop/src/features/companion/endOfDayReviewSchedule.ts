import { END_OF_DAY_REVIEW_STORAGE_KEY } from "./endOfDayReviewData";

/**
 * The user's review time. When the review is actually offered is decided by
 * `dayReviewScheduler.ts`; this module only owns the preference and its
 * half-hour option list.
 */
export const END_OF_DAY_REVIEW_MINUTE_STORAGE_KEY = "drifty.endOfDayReview.reviewMinute";

/** v1 acknowledgement key, read once by the v2 record migration. */
export { END_OF_DAY_REVIEW_STORAGE_KEY };

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

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

