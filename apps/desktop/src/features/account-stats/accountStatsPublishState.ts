// Local publish-state machine for the account activity summary — a simplified clone of
// leaderboardAutoPublishState (single record per user, no periods). Decides when a cycle
// should actually hit Supabase: dedup identical payloads, back off after failures, and
// re-publish unchanged payloads on a heartbeat so `updated_at` stays fresh for the web page.
import type { AccountStatsPayload } from "./accountStatsPayload";

export const ACCOUNT_STATS_PUBLISH_STORAGE_KEY = "drifty.accountStats.publish.v1";
/** After a failed publish, wait this long before trying again. */
export const ACCOUNT_STATS_FAILURE_BACKOFF_MS = 15 * 60 * 1000;
/** A changed payload still waits this long after the last success (rate limit). */
export const ACCOUNT_STATS_MIN_SUCCESS_INTERVAL_MS = 15 * 60 * 1000;
/** Re-publish even an unchanged payload after this long, so the row never looks stale. */
export const ACCOUNT_STATS_HEARTBEAT_MS = 6 * 60 * 60 * 1000;

export type AccountStatsPublishRecord = {
  readonly userScopeKey: string;
  readonly payloadKey: string;
  readonly lastAttemptAt: string;
  readonly lastSuccessAt: string | null;
  readonly lastErrorAt: string | null;
};

export type AccountStatsPublishDecisionReason =
  | "no_record"
  | "payload_changed"
  | "heartbeat_due"
  | "same_payload_recent"
  | "min_interval"
  | "failure_backoff";

export type AccountStatsPublishDecision = {
  readonly shouldPublish: boolean;
  readonly reason: AccountStatsPublishDecisionReason;
};

function getStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function parseRecord(value: unknown): AccountStatsPublishRecord | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("userScopeKey" in value) || !("payloadKey" in value) || !("lastAttemptAt" in value) || !("lastSuccessAt" in value) || !("lastErrorAt" in value)) {
    return null;
  }
  const lastSuccessAt = nullableString(value.lastSuccessAt);
  const lastErrorAt = nullableString(value.lastErrorAt);
  if (
    typeof value.userScopeKey !== "string" ||
    typeof value.payloadKey !== "string" ||
    typeof value.lastAttemptAt !== "string" ||
    lastSuccessAt === undefined ||
    lastErrorAt === undefined
  ) {
    return null;
  }
  return {
    userScopeKey: value.userScopeKey,
    payloadKey: value.payloadKey,
    lastAttemptAt: value.lastAttemptAt,
    lastSuccessAt,
    lastErrorAt,
  };
}

function parseStoredRecords(value: string | null): readonly AccountStatsPublishRecord[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const record = parseRecord(item);
      return record ? [record] : [];
    });
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

function toTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Content hash of the payload: seconds rounded (they already are, but re-round defensively)
 * so tiny float jitter can never defeat the dedup.
 */
export function buildAccountStatsPayloadKey(payload: AccountStatsPayload): string {
  return JSON.stringify({
    focusSecondsToday: Math.round(payload.focusSecondsToday),
    driftSecondsToday: Math.round(payload.driftSecondsToday),
    neutralSecondsToday: Math.round(payload.neutralSecondsToday),
    categoryBreakdownToday: payload.categoryBreakdownToday,
    focusSeconds7d: Math.round(payload.focusSeconds7d),
    driftSeconds7d: Math.round(payload.driftSeconds7d),
    neutralSeconds7d: Math.round(payload.neutralSeconds7d),
    focusShare7d: Number(payload.focusShare7d.toFixed(4)),
    categoryBreakdown7d: payload.categoryBreakdown7d,
    hourlyPattern7d: payload.hourlyPattern7d,
    topApps7d: payload.topApps7d,
    dailySeries30d: payload.dailySeries30d,
    windowEndDate: payload.windowEndDate,
    timezone: payload.timezone,
  });
}

export function readAccountStatsPublishRecords(): readonly AccountStatsPublishRecord[] {
  const storage = getStorage();
  if (!storage) return [];
  return parseStoredRecords(storage.getItem(ACCOUNT_STATS_PUBLISH_STORAGE_KEY));
}

export function writeAccountStatsPublishRecords(records: readonly AccountStatsPublishRecord[]): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(ACCOUNT_STATS_PUBLISH_STORAGE_KEY, JSON.stringify(records));
}

export function findAccountStatsPublishRecord(
  records: readonly AccountStatsPublishRecord[],
  userScopeKey: string,
): AccountStatsPublishRecord | null {
  return records.find((record) => record.userScopeKey === userScopeKey) ?? null;
}

export function upsertAccountStatsPublishRecord(
  currentRecords: readonly AccountStatsPublishRecord[],
  nextRecord: AccountStatsPublishRecord,
): readonly AccountStatsPublishRecord[] {
  const records = currentRecords.slice();
  const index = records.findIndex((record) => record.userScopeKey === nextRecord.userScopeKey);
  if (index === -1) records.push(nextRecord);
  else records[index] = nextRecord;
  return records;
}

export function shouldPublishAccountStats({
  record,
  payloadKey,
  now,
}: {
  readonly record: AccountStatsPublishRecord | null;
  readonly payloadKey: string;
  readonly now: Date;
}): AccountStatsPublishDecision {
  if (!record) {
    return { shouldPublish: true, reason: "no_record" };
  }

  const nowMs = now.getTime();
  const lastErrorMs = toTimestamp(record.lastErrorAt);
  if (lastErrorMs !== null && nowMs - lastErrorMs < ACCOUNT_STATS_FAILURE_BACKOFF_MS) {
    return { shouldPublish: false, reason: "failure_backoff" };
  }

  const lastSuccessMs = toTimestamp(record.lastSuccessAt);
  if (lastSuccessMs === null) {
    return { shouldPublish: true, reason: "no_record" };
  }

  const successAgeMs = nowMs - lastSuccessMs;
  if (record.payloadKey === payloadKey) {
    if (successAgeMs >= ACCOUNT_STATS_HEARTBEAT_MS) {
      return { shouldPublish: true, reason: "heartbeat_due" };
    }
    return { shouldPublish: false, reason: "same_payload_recent" };
  }

  if (successAgeMs < ACCOUNT_STATS_MIN_SUCCESS_INTERVAL_MS) {
    return { shouldPublish: false, reason: "min_interval" };
  }

  return { shouldPublish: true, reason: "payload_changed" };
}

/** Record the outcome of a publish attempt (success refreshes the key; failure keeps it). */
export function recordAccountStatsPublishAttempt({
  userScopeKey,
  payloadKey,
  success,
  now,
}: {
  readonly userScopeKey: string;
  readonly payloadKey: string;
  readonly success: boolean;
  readonly now: Date;
}): void {
  const records = readAccountStatsPublishRecords();
  const existing = findAccountStatsPublishRecord(records, userScopeKey);
  const nowIso = now.toISOString();
  const next: AccountStatsPublishRecord = success
    ? { userScopeKey, payloadKey, lastAttemptAt: nowIso, lastSuccessAt: nowIso, lastErrorAt: null }
    : {
        userScopeKey,
        payloadKey: existing?.payloadKey ?? payloadKey,
        lastAttemptAt: nowIso,
        lastSuccessAt: existing?.lastSuccessAt ?? null,
        lastErrorAt: nowIso,
      };
  writeAccountStatsPublishRecords(upsertAccountStatsPublishRecord(records, next));
}
