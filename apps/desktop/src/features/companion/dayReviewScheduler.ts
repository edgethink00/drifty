import { logicalDayEndExclusiveMs, logicalDayIsoDateForDate, logicalDayStartMs, shiftIsoDate } from "@drifty/domain";
import { END_OF_DAY_REVIEW_MIN_TRACKED_SECONDS, END_OF_DAY_REVIEW_STORAGE_KEY } from "./endOfDayReviewData";

/**
 * Day Review scheduling, stated once (product decision 2026-10-04):
 *
 *   The review may appear from the user's review time until two hours before
 *   the logical day ends. Inside that window it is evaluated once a minute
 *   while the user is at the machine and quiet hours are not active, and it is
 *   presented the first time the day has at least three tracked hours. A day
 *   whose window closes without a presentation is over; nothing carries into
 *   the next day. A card the Companion had to defer behind a fullscreen app
 *   until it expired is rebuilt once.
 *
 * Everything the scheduler needs to decide is passed in as values, so the
 * decision is a pure function and the record it reads and writes is a single
 * per-day object. Earlier revisions spread the same facts across five storage
 * keys, three refs, and two competing effects, and each race between them
 * needed its own fix.
 */

export const DAY_REVIEW_WINDOW_END_OFFSET_MINUTES = 120;
export const DAY_REVIEW_MIN_WINDOW_MINUTES = 60;
export const DAY_REVIEW_ACTIVE_IDLE_LIMIT_SECONDS = 120;
export const DAY_REVIEW_MAX_PRESENTATIONS = 2;
export const DAY_REVIEW_TICK_INTERVAL_MS = 60 * 1000;

export const DAY_REVIEW_RECORD_STORAGE_KEY = "drifty.endOfDayReview.record.v2";
export const DAY_REVIEW_DECISIONS_STORAGE_KEY = "drifty.endOfDayReview.decisions.v2";
const DAY_REVIEW_DECISION_LOG_LIMIT = 40;

/** Storage keys retired by the v2 record; cleared once on migration. */
export const DAY_REVIEW_LEGACY_STORAGE_KEYS = [
  END_OF_DAY_REVIEW_STORAGE_KEY,
  "drifty.endOfDayReview.catchUpHandledDay",
  "drifty.endOfDayReview.lastPresentationDay.v1",
  "drifty.endOfDayReview.presentations.v1",
] as const;

export type DayReviewRecordStatus = "pending" | "presented" | "acknowledged" | "closed";

export type DayReviewCloseReason =
  | "window_ended"
  | "install_day"
  | "surface_disabled"
  | "presentation_limit";

export type DayReviewRecord = {
  readonly day: string;
  readonly status: DayReviewRecordStatus;
  /** Cards the native surface accepted for this day. */
  readonly presentations: number;
  readonly lastPresentedAt: string | null;
  /** The Companion reported that the last card expired without being seen. */
  readonly expiredUnseen: boolean;
  readonly closedReason: DayReviewCloseReason | null;
  readonly acknowledgedAt: string | null;
};

export type DayReviewWindow = {
  readonly day: string;
  readonly startMs: number;
  readonly endMs: number;
};

export type DayReviewDecision =
  | { readonly action: "present"; readonly reason: "due" | "retry_after_unseen" }
  | {
    readonly action: "wait";
    readonly reason:
      | "disabled"
      | "before_window"
      | "quiet_hours"
      | "user_idle"
      | "awaiting_acknowledgement"
      | "tracked_unknown"
      | "thin_day";
  }
  | { readonly action: "close"; readonly reason: DayReviewCloseReason }
  | { readonly action: "none"; readonly reason: "preview_surface" | "already_closed" | "already_acknowledged" };

export type DayReviewDecisionInput = {
  readonly nowMs: number;
  readonly day: string;
  readonly reviewMinute: number;
  readonly startOfDayMinutes: number;
  readonly enabled: boolean;
  readonly previewSurface: boolean;
  readonly installDayEligible: boolean;
  readonly quietHoursActive: boolean;
  readonly userActive: boolean;
  /** `null` while the day's timeline has not been read yet. */
  readonly trackedSeconds: number | null;
  readonly record: DayReviewRecord | null;
};

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE_MS = 60 * 1000;

export function createDayReviewRecord(day: string): DayReviewRecord {
  return {
    day,
    status: "pending",
    presentations: 0,
    lastPresentedAt: null,
    expiredUnseen: false,
    closedReason: null,
    acknowledgedAt: null,
  };
}

/**
 * The wall-clock instant of the review minute inside the logical day. A
 * review clock earlier than the logical-day start belongs to the following
 * calendar date within that same logical day.
 */
export function dayReviewStartMs(day: string, reviewMinute: number, startOfDayMinutes: number): number {
  const calendarDay = reviewMinute < startOfDayMinutes ? shiftIsoDate(day, 1) : day;
  const [year, month, date] = calendarDay.split("-").map(Number);
  return new Date(year, month - 1, date, Math.floor(reviewMinute / 60), reviewMinute % 60, 0, 0).getTime();
}

/**
 * Window = [review time, logical day end - 2h], but never shorter than one
 * hour and never past the logical day end. The clamp only matters for
 * settings that place the review clock inside the last hours of the day.
 */
export function resolveDayReviewWindow(day: string, reviewMinute: number, startOfDayMinutes: number): DayReviewWindow {
  const startMs = dayReviewStartMs(day, reviewMinute, startOfDayMinutes);
  const dayEndMs = logicalDayEndExclusiveMs(day, startOfDayMinutes);
  const preferredEndMs = dayEndMs - DAY_REVIEW_WINDOW_END_OFFSET_MINUTES * MINUTE_MS;
  const minimumEndMs = startMs + DAY_REVIEW_MIN_WINDOW_MINUTES * MINUTE_MS;
  const endMs = Math.min(dayEndMs, Math.max(preferredEndMs, minimumEndMs));
  return { day, startMs, endMs };
}

export function resolveDayReviewDecision(input: DayReviewDecisionInput): DayReviewDecision {
  if (input.previewSurface) return { action: "none", reason: "preview_surface" };
  const record = input.record ?? createDayReviewRecord(input.day);
  if (record.status === "closed") return { action: "none", reason: "already_closed" };
  if (record.status === "acknowledged") return { action: "none", reason: "already_acknowledged" };

  const window = resolveDayReviewWindow(input.day, input.reviewMinute, input.startOfDayMinutes);
  if (input.nowMs >= window.endMs) return { action: "close", reason: "window_ended" };
  if (!input.enabled) return { action: "wait", reason: "disabled" };
  if (!input.installDayEligible) return { action: "close", reason: "install_day" };
  if (input.nowMs < window.startMs) return { action: "wait", reason: "before_window" };
  if (input.quietHoursActive) return { action: "wait", reason: "quiet_hours" };
  if (!input.userActive) return { action: "wait", reason: "user_idle" };

  if (record.status === "presented") {
    if (!record.expiredUnseen) return { action: "wait", reason: "awaiting_acknowledgement" };
    if (record.presentations >= DAY_REVIEW_MAX_PRESENTATIONS) return { action: "close", reason: "presentation_limit" };
    return { action: "present", reason: "retry_after_unseen" };
  }
  if (record.presentations >= DAY_REVIEW_MAX_PRESENTATIONS) return { action: "close", reason: "presentation_limit" };

  if (input.trackedSeconds === null) return { action: "wait", reason: "tracked_unknown" };
  if (input.trackedSeconds < END_OF_DAY_REVIEW_MIN_TRACKED_SECONDS) return { action: "wait", reason: "thin_day" };
  return { action: "present", reason: "due" };
}

export function isDayReviewUserActive(input: {
  readonly idleSeconds: number | null | undefined;
  readonly idleDetectionAvailable: boolean | null | undefined;
}): boolean {
  if (input.idleDetectionAvailable === false) return true;
  if (typeof input.idleSeconds !== "number" || !Number.isFinite(input.idleSeconds)) return true;
  return input.idleSeconds <= DAY_REVIEW_ACTIVE_IDLE_LIMIT_SECONDS;
}

/* ------------------------------------------------------------------------- */
/* Record storage                                                             */
/* ------------------------------------------------------------------------- */

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function parseRecord(raw: string | null): DayReviewRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.day !== "string" || !ISO_DAY_PATTERN.test(candidate.day)) return null;
    const status = candidate.status;
    if (status !== "pending" && status !== "presented" && status !== "acknowledged" && status !== "closed") return null;
    const presentations = typeof candidate.presentations === "number" && Number.isFinite(candidate.presentations)
      ? Math.max(0, Math.floor(candidate.presentations))
      : 0;
    const closedReason = candidate.closedReason;
    return {
      day: candidate.day,
      status,
      presentations,
      lastPresentedAt: typeof candidate.lastPresentedAt === "string" ? candidate.lastPresentedAt : null,
      expiredUnseen: candidate.expiredUnseen === true,
      closedReason: closedReason === "window_ended" || closedReason === "install_day"
        || closedReason === "surface_disabled" || closedReason === "presentation_limit"
        ? closedReason
        : null,
      acknowledgedAt: typeof candidate.acknowledgedAt === "string" ? candidate.acknowledgedAt : null,
    };
  } catch {
    return null;
  }
}

/**
 * The record for `day`, or `null` when storage holds another day. The v1
 * keys are folded in once: a day the old scheduler had already acknowledged
 * stays acknowledged, and the rest of the v1 state is dropped because the
 * catch-up it served no longer exists.
 */
export function readDayReviewRecord(day: string, storage = browserStorage()): DayReviewRecord | null {
  if (!storage) return null;
  const record = parseRecord(storage.getItem(DAY_REVIEW_RECORD_STORAGE_KEY));
  if (record) return record.day === day ? record : null;
  return migrateLegacyDayReviewState(day, storage);
}

function migrateLegacyDayReviewState(day: string, storage: Storage): DayReviewRecord | null {
  const legacyShownDay = storage.getItem(END_OF_DAY_REVIEW_STORAGE_KEY);
  const hasLegacyState = DAY_REVIEW_LEGACY_STORAGE_KEYS.some((key) => storage.getItem(key) !== null);
  if (!hasLegacyState) return null;
  let migrated: DayReviewRecord | null = null;
  if (legacyShownDay === day) {
    migrated = { ...createDayReviewRecord(day), status: "acknowledged", presentations: 1, acknowledgedAt: null };
    writeDayReviewRecord(migrated, storage);
  }
  for (const key of DAY_REVIEW_LEGACY_STORAGE_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // A stale legacy key is harmless; the v2 record is authoritative.
    }
  }
  return migrated;
}

export function writeDayReviewRecord(record: DayReviewRecord, storage = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(DAY_REVIEW_RECORD_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Losing the record can at most re-offer one card inside the same window.
  }
}

function updateDayReviewRecord(
  day: string,
  update: (record: DayReviewRecord) => DayReviewRecord,
  storage = browserStorage(),
): DayReviewRecord | null {
  if (!storage) return null;
  const next = update(readDayReviewRecord(day, storage) ?? createDayReviewRecord(day));
  writeDayReviewRecord(next, storage);
  return next;
}

export function recordDayReviewPresentation(day: string, nowIso: string, storage = browserStorage()): DayReviewRecord | null {
  return updateDayReviewRecord(day, (record) => ({
    ...record,
    status: "presented",
    presentations: record.presentations + 1,
    lastPresentedAt: nowIso,
    expiredUnseen: false,
  }), storage);
}

/**
 * A surface saw the card. The Companion writes this into the shared webview
 * storage before its native handoff, so the main window's next tick already
 * sees the day as finished.
 */
export function acknowledgeDayReview(day: string, nowIso: string, storage = browserStorage()): DayReviewRecord | null {
  if (!ISO_DAY_PATTERN.test(day)) return null;
  return updateDayReviewRecord(day, (record) => (
    record.status === "closed"
      ? record
      : { ...record, status: "acknowledged", acknowledgedAt: record.acknowledgedAt ?? nowIso }
  ), storage);
}

export function recordDayReviewUnseen(day: string, storage = browserStorage()): DayReviewRecord | null {
  if (!ISO_DAY_PATTERN.test(day)) return null;
  return updateDayReviewRecord(day, (record) => (
    record.status === "presented" ? { ...record, expiredUnseen: true } : record
  ), storage);
}

export function closeDayReview(day: string, reason: DayReviewCloseReason, storage = browserStorage()): DayReviewRecord | null {
  return updateDayReviewRecord(day, (record) => (
    record.status === "acknowledged" || record.status === "closed"
      ? record
      : { ...record, status: "closed", closedReason: reason }
  ), storage);
}

/** A delivery the native layer dropped without reaching a surface. */
export function revertDayReviewPresentation(day: string, storage = browserStorage()): DayReviewRecord | null {
  return updateDayReviewRecord(day, (record) => (
    record.status === "presented" ? { ...record, status: "pending", expiredUnseen: false } : record
  ), storage);
}

/* ------------------------------------------------------------------------- */
/* Decision log for the debug bundle                                         */
/* ------------------------------------------------------------------------- */

export type DayReviewDecisionLogEntry = {
  readonly at: string;
  readonly day: string;
  readonly action: DayReviewDecision["action"];
  readonly reason: DayReviewDecision["reason"];
  readonly trackedSeconds: number | null;
};

function parseDecisionLog(raw: string | null): DayReviewDecisionLogEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is DayReviewDecisionLogEntry => (
      !!entry && typeof entry === "object"
      && typeof (entry as DayReviewDecisionLogEntry).at === "string"
      && typeof (entry as DayReviewDecisionLogEntry).day === "string"
      && typeof (entry as DayReviewDecisionLogEntry).action === "string"
      && typeof (entry as DayReviewDecisionLogEntry).reason === "string"
    ));
  } catch {
    return [];
  }
}

export function readDayReviewDecisionLog(storage = browserStorage()): DayReviewDecisionLogEntry[] {
  if (!storage) return [];
  return parseDecisionLog(storage.getItem(DAY_REVIEW_DECISIONS_STORAGE_KEY));
}

/**
 * Appends a decision only when it differs from the previous one for the same
 * day, so a quiet evening of identical "wait" ticks costs one line.
 */
export function appendDayReviewDecision(entry: DayReviewDecisionLogEntry, storage = browserStorage()): void {
  if (!storage) return;
  const log = readDayReviewDecisionLog(storage);
  const last = log[log.length - 1];
  if (last && last.day === entry.day && last.action === entry.action && last.reason === entry.reason) return;
  const next = [...log, entry].slice(-DAY_REVIEW_DECISION_LOG_LIMIT);
  try {
    storage.setItem(DAY_REVIEW_DECISIONS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Diagnostics only.
  }
}

export type DayReviewDiagnostics = {
  readonly record: DayReviewRecord | null;
  readonly window: { readonly day: string; readonly startsAt: string; readonly endsAt: string } | null;
  readonly decisions: DayReviewDecisionLogEntry[];
};

export function readDayReviewDiagnostics(input: {
  readonly now: Date;
  readonly reviewMinute: number;
  readonly startOfDayMinutes: number;
}, storage = browserStorage()): DayReviewDiagnostics {
  const day = logicalDayIsoDateForDate(input.now, input.startOfDayMinutes);
  const window = resolveDayReviewWindow(day, input.reviewMinute, input.startOfDayMinutes);
  return {
    record: storage ? readDayReviewRecord(day, storage) : null,
    window: {
      day,
      startsAt: new Date(window.startMs).toISOString(),
      endsAt: new Date(window.endMs).toISOString(),
    },
    decisions: readDayReviewDecisionLog(storage),
  };
}

/** Exposed for the debug bundle and tests; the logical day the scheduler is working on. */
export function dayReviewLogicalDay(now: Date, startOfDayMinutes: number): string {
  return logicalDayIsoDateForDate(now, startOfDayMinutes);
}

export { logicalDayStartMs as dayReviewLogicalDayStartMs };


