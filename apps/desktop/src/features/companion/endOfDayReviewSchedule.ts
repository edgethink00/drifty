import { shiftIsoDate } from "@drifty/domain";
import { END_OF_DAY_REVIEW_STORAGE_KEY } from "./endOfDayReviewData";

/**
 * The day review used to fire at a fixed 8 PM, borrowed from the leaderboard
 * checkpoint. Someone who closes the laptop at six never saw it. The review
 * time is now the user's own, and a day whose review never got shown is
 * offered once more on the next launch instead of silently disappearing.
 */
export const END_OF_DAY_REVIEW_MINUTE_STORAGE_KEY = "drifty.endOfDayReview.reviewMinute";
export const END_OF_DAY_REVIEW_CATCH_UP_STORAGE_KEY = "drifty.endOfDayReview.catchUpHandledDay";
export const END_OF_DAY_REVIEW_LAST_PRESENTATION_DAY_STORAGE_KEY =
  "drifty.endOfDayReview.lastPresentationDay.v1";

export const DEFAULT_END_OF_DAY_REVIEW_MINUTE = 20 * 60;
export const END_OF_DAY_REVIEW_CATCH_UP_EARLIEST_MINUTE = 8 * 60;

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
 * A logical day may continue past midnight, but its evening review must not
 * interrupt the user overnight. A missed review is offered as a catch-up on
 * the following morning instead.
 */
export function isEndOfDayReviewDue(
  currentMinuteOfDay: number,
  reviewMinute: number,
  startOfDayMinutes: number,
): boolean {
  const minutesPerDay = 24 * 60;
  const logicalMinute = (currentMinuteOfDay - startOfDayMinutes + minutesPerDay) % minutesPerDay;
  const logicalReviewMinute = (reviewMinute - startOfDayMinutes + minutesPerDay) % minutesPerDay;
  return currentMinuteOfDay >= reviewMinute && logicalMinute >= logicalReviewMinute;
}

/** A queued review from before midnight must not surface after midnight. */
export function endOfDayReviewDeliveryDeadline(deadline: string, deliveryTime: Date): string {
  const nextMidnight = new Date(
    deliveryTime.getFullYear(),
    deliveryTime.getMonth(),
    deliveryTime.getDate() + 1,
  ).getTime();
  return new Date(Math.min(Date.parse(deadline), nextMidnight)).toISOString();
}

/** The wall-clock instant at which today's review supersedes a catch-up. */
export function endOfDayReviewDeadlineForDay(
  day: string,
  reviewMinute: number,
  startOfDayMinutes: number,
): string {
  /* When the selected review clock is earlier than the logical day start, it
     belongs to the following calendar date within that same logical day. */
  const deadlineDay = reviewMinute < startOfDayMinutes ? shiftIsoDate(day, 1) : day;
  const [year, month, dayOfMonth] = deadlineDay.split("-").map(Number);
  const deadline = new Date(
    year,
    month - 1,
    dayOfMonth,
    Math.floor(reviewMinute / 60),
    reviewMinute % 60,
    0,
    0,
  );
  return deadline.toISOString();
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
  readonly lastPresentationDay?: string | null;
  readonly currentReviewDue?: boolean;
  readonly currentMinuteOfDay: number;
}): EndOfDayReviewCatchUp | null {
  /* Catch-up is a morning recovery path, not a second review competing with
     today's card. Once today's review time arrives, today owns the slot. */
  if (input.currentReviewDue) return null;
  if (input.currentMinuteOfDay < END_OF_DAY_REVIEW_CATCH_UP_EARLIEST_MINUTE) return null;
  /* A review already presented during this logical day has used the single
     interruption slot, even when the card summarized yesterday. */
  if (input.lastPresentationDay === input.todayDay) return null;
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

/**
 * The reviewed day and the day on which the card interrupted the user are
 * different for catch-up. Keep both identities: target-day markers prevent
 * replaying the same summary, while this marker enforces at most one visible
 * Day Review interruption per logical day.
 */
export function readEndOfDayReviewLastPresentationDay(storage = browserStorage()): string | null {
  if (!storage) return null;
  const value = storage.getItem(END_OF_DAY_REVIEW_LAST_PRESENTATION_DAY_STORAGE_KEY);
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function persistEndOfDayReviewLastPresentationDay(day: string, storage = browserStorage()): void {
  if (!storage || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  try {
    storage.setItem(END_OF_DAY_REVIEW_LAST_PRESENTATION_DAY_STORAGE_KEY, day);
  } catch {
    // Losing the marker may permit another card, but must not break the app.
  }
}

/**
 * Persist the acknowledgement in the shared webview storage before the
 * best-effort native event handoff. The main and Companion webviews share this
 * origin, so a close cannot open a gap in which the scheduler still sees the
 * day as eligible.
 */
export function persistEndOfDayReviewAcknowledgement(
  reviewDay: string,
  presentationDay: string,
  storage = browserStorage(),
): void {
  if (!storage || !/^\d{4}-\d{2}-\d{2}$/.test(reviewDay)) return;
  try {
    storage.setItem(END_OF_DAY_REVIEW_STORAGE_KEY, reviewDay);
  } catch {
    // The presentation-day marker below may still close the interruption slot.
  }
  persistEndOfDayReviewCatchUpHandledDay(reviewDay, storage);
  persistEndOfDayReviewLastPresentationDay(presentationDay, storage);
}

/**
 * A day whose review was presented but never acknowledged used to stay open
 * indefinitely: the automatic evaluation re-presented the same card on every
 * cooldown window until the logical day rolled over, and the catch-up offered
 * yesterday again on every launch. The acknowledgement is still what marks a
 * day as genuinely seen; this ledger only bounds how often an unacknowledged
 * day may be presented, so a display report that never arrives costs a missed
 * card instead of an evening of repeats.
 *
 * Presentation allowances still belong to the reviewed day, so an unseen
 * attempt for yesterday cannot consume today's retry allowance. Separate
 * delivery arbitration above prevents both cards from interrupting the user
 * during the same logical day.
 */
export const END_OF_DAY_REVIEW_PRESENTATION_STORAGE_KEY = "drifty.endOfDayReview.presentations.v1";
export const END_OF_DAY_REVIEW_MAX_PRESENTATIONS_PER_DAY = 2;

/** Only today and yesterday can still be presented; the rest is dead weight. */
const END_OF_DAY_REVIEW_PRESENTATION_HISTORY_DAYS = 4;

function readEndOfDayReviewPresentationLedger(storage: Storage): Record<string, number> {
  try {
    const raw = storage.getItem(END_OF_DAY_REVIEW_PRESENTATION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const ledger: Record<string, number> = {};
    for (const [day, count] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
      ledger[day] = Math.floor(count);
    }
    return ledger;
  } catch {
    return {};
  }
}

export function readEndOfDayReviewPresentationCount(day: string, storage = browserStorage()): number {
  if (!storage) return 0;
  return readEndOfDayReviewPresentationLedger(storage)[day] ?? 0;
}

export function hasExhaustedEndOfDayReviewPresentations(day: string, storage = browserStorage()): boolean {
  return readEndOfDayReviewPresentationCount(day, storage) >= END_OF_DAY_REVIEW_MAX_PRESENTATIONS_PER_DAY;
}

/** Only a presentation the native surface accepted counts against the day. */
export function recordEndOfDayReviewPresentation(day: string, storage = browserStorage()): number {
  if (!storage) return 1;
  const ledger = readEndOfDayReviewPresentationLedger(storage);
  const next = (ledger[day] ?? 0) + 1;
  ledger[day] = next;
  const recentDays = Object.keys(ledger).sort().slice(-END_OF_DAY_REVIEW_PRESENTATION_HISTORY_DAYS);
  try {
    storage.setItem(
      END_OF_DAY_REVIEW_PRESENTATION_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(recentDays.map((entry) => [entry, ledger[entry]]))),
    );
  } catch {
    // Losing the ledger only restores the previous unbounded retry behaviour.
  }
  return next;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}
