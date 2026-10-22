import { useCallback, useEffect, useRef, useState } from "react";
import type { BillingEntitlement } from "./billingService";
import { canStartCloudTrial } from "./billingEligibility";

/**
 * What follows inactive Pro access (trial: 2026-10-10; plan: 2026-10-22):
 *   sheet  - the Pro sheet opens once, the first time the dashboard shows after the end;
 *            an account whose trial ended before this release gets it once too
 *   notice - from the next logical day, a two-line notice once a day while today's
 *            unclassified time is past TRIAL_END_NOTICE_MIN_UNCLASSIFIED_SECONDS
 *   quiet  - the status pill and the sidebar only
 * There is no permanent off. The follow-up ends when the account stops being
 * trial-expired / billing-missing (a purchase) or classification moves to Local AI or the user's own key;
 * the caller stops passing a key then. Marks persist per account and expiry, so a later
 * dated expiry starts over.
 */
export type TrialEndFollowUpStage = "sheet" | "notice" | "quiet";
export const TRIAL_END_NOTICE_MIN_UNCLASSIFIED_SECONDS = 30 * 60;

// Retain trial-era storage prefixes so updating never repeats settled trial offers.
const SHEET_PREFIX = "drifty:billing:trial-end-sheet-day:v1";
const NOTICE_PREFIX = "drifty:billing:trial-end-notice-day:v1";

/** One follow-up per account and confirmed expiry. */
export function getTrialEndFollowUpKey(userId: string | null | undefined, entitlement: BillingEntitlement | null | undefined): string | null {
  if (!userId || entitlement?.status !== "locked" || entitlement.entitlementOwner === "organization" || canStartCloudTrial(entitlement)) return null;
  if (entitlement.lockedReason !== "trial_expired" && entitlement.lockedReason !== "billing_missing") return null;
  const planInactive = entitlement.lockedReason === "billing_missing";
  const endAt = planInactive ? entitlement.currentPeriodEnd : entitlement.trialEndsAt;
  const end = endAt ? Date.parse(endAt) : NaN;
  const expiry = Number.isFinite(end) ? new Date(end).toISOString() : "unknown-expiry";
  // Preserve existing trial marks; a paid plan has its own period and cannot reuse trial dates.
  return `${encodeURIComponent(userId)}:${planInactive ? "plan:" : ""}${expiry}`;
}

/** Days are logical-day ISO dates (the user's start-of-day setting), like Dayflow's 4 a.m. day. */
export function resolveTrialEndFollowUpStage(input: {
  readonly sheetDay: string | null;
  readonly noticeDay: string | null;
  readonly today: string;
  readonly unclassifiedSeconds: number | null;
}): TrialEndFollowUpStage {
  if (input.sheetDay === null) return "sheet";
  // Nothing more on the day the sheet was closed, and one notice per day after that.
  if (input.sheetDay === input.today || input.noticeDay === input.today) return "quiet";
  return (input.unclassifiedSeconds ?? 0) >= TRIAL_END_NOTICE_MIN_UNCLASSIFIED_SECONDS ? "notice" : "quiet";
}

function readDay(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeDay(key: string, day: string): void {
  try {
    window.localStorage.setItem(key, day);
  } catch {
    // The in-memory mark still applies for this session when storage is unavailable.
  }
}

export function useTrialEndFollowUp(key: string | null, today: string, unclassifiedSeconds: number | null) {
  const sessionMarks = useRef(new Map<string, string>());
  const [, setRevision] = useState(0);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(SHEET_PREFIX) || event.key.startsWith(NOTICE_PREFIX)) setRevision((revision) => revision + 1);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const sheetKey = key ? `${SHEET_PREFIX}:${key}` : null;
  const noticeKey = key ? `${NOTICE_PREFIX}:${key}` : null;
  const read = (storageKey: string | null) => (storageKey ? readDay(storageKey) ?? sessionMarks.current.get(storageKey) ?? null : null);
  const stage: TrialEndFollowUpStage | null = key === null ? null : resolveTrialEndFollowUpStage({
    sheetDay: read(sheetKey),
    noticeDay: read(noticeKey),
    today,
    unclassifiedSeconds,
  });

  const mark = useCallback((storageKey: string | null) => {
    if (!storageKey) return;
    sessionMarks.current.set(storageKey, today);
    writeDay(storageKey, today);
    setRevision((revision) => revision + 1);
  }, [today]);
  const markSheetSeen = useCallback(() => mark(sheetKey), [mark, sheetKey]);
  const markNoticeSeen = useCallback(() => mark(noticeKey), [mark, noticeKey]);

  return { stage, markSheetSeen, markNoticeSeen };
}
