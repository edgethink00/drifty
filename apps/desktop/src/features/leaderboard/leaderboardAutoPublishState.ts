import type { LeaderboardPeriod } from "./leaderboardService";

export const LEADERBOARD_AUTO_PUBLISH_STORAGE_KEY = "drifty.leaderboardAutoPublish.v1";
export const LEADERBOARD_AUTO_PUBLISH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const LEADERBOARD_AUTO_PUBLISH_MIN_SUCCESS_INTERVAL_MS = LEADERBOARD_AUTO_PUBLISH_INTERVAL_MS;
export const LEADERBOARD_AUTO_PUBLISH_HEARTBEAT_MS = LEADERBOARD_AUTO_PUBLISH_INTERVAL_MS;
export const LEADERBOARD_AUTO_PUBLISH_FAILURE_BACKOFF_MS = 15 * 60 * 1000;

export type LeaderboardAutoPublishPayloadKeyInput = {
  readonly profileDisplayName: string;
  readonly period: LeaderboardPeriod;
  readonly focusSeconds: number;
  readonly windowStartDay: string;
  readonly windowEndDay: string;
  readonly timezone: string;
};

export type LeaderboardAutoPublishRecord = {
  readonly userScopeKey: string;
  readonly period: LeaderboardPeriod;
  readonly payloadKey: string;
  readonly lastAttemptAt: string;
  readonly lastSuccessAt: string | null;
  readonly lastErrorAt: string | null;
};

export type LeaderboardAutoPublishDecisionReason =
  | "no_record"
  | "payload_changed"
  | "heartbeat_due"
  | "same_payload_recent"
  | "min_interval"
  | "failure_backoff";

export type LeaderboardAutoPublishDecision = {
  readonly shouldPublish: boolean;
  readonly reason: LeaderboardAutoPublishDecisionReason;
  readonly requiresRemoteOptInCheck: boolean;
};

function getStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isLeaderboardPeriod(value: unknown): value is LeaderboardPeriod {
  return value === "daily" || value === "weekly" || value === "monthly";
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function parseRecord(value: unknown): LeaderboardAutoPublishRecord | null {
  if (typeof value !== "object" || value === null) return null;
  if (
    !("userScopeKey" in value) ||
    !("period" in value) ||
    !("payloadKey" in value) ||
    !("lastAttemptAt" in value) ||
    !("lastSuccessAt" in value) ||
    !("lastErrorAt" in value)
  ) {
    return null;
  }

  const lastSuccessAt = nullableString(value.lastSuccessAt);
  const lastErrorAt = nullableString(value.lastErrorAt);
  if (
    typeof value.userScopeKey !== "string" ||
    !isLeaderboardPeriod(value.period) ||
    typeof value.payloadKey !== "string" ||
    typeof value.lastAttemptAt !== "string" ||
    lastSuccessAt === undefined ||
    lastErrorAt === undefined
  ) {
    return null;
  }

  return {
    userScopeKey: value.userScopeKey,
    period: value.period,
    payloadKey: value.payloadKey,
    lastAttemptAt: value.lastAttemptAt,
    lastSuccessAt,
    lastErrorAt,
  };
}

function parseStoredRecords(value: string | null): readonly LeaderboardAutoPublishRecord[] {
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

export function buildLeaderboardAutoPublishPayloadKey(input: LeaderboardAutoPublishPayloadKeyInput): string {
  return JSON.stringify({
    profileDisplayName: input.profileDisplayName.trim(),
    period: input.period,
    focusSeconds: Math.max(0, Math.round(input.focusSeconds)),
    windowStartDay: input.windowStartDay,
    windowEndDay: input.windowEndDay,
    timezone: input.timezone,
  });
}

export function readLeaderboardAutoPublishRecords(): readonly LeaderboardAutoPublishRecord[] {
  const storage = getStorage();
  if (!storage) return [];
  return parseStoredRecords(storage.getItem(LEADERBOARD_AUTO_PUBLISH_STORAGE_KEY));
}

export function writeLeaderboardAutoPublishRecords(records: readonly LeaderboardAutoPublishRecord[]): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(LEADERBOARD_AUTO_PUBLISH_STORAGE_KEY, JSON.stringify(records));
}

export function findLeaderboardAutoPublishRecord(
  records: readonly LeaderboardAutoPublishRecord[],
  userScopeKey: string,
  period: LeaderboardPeriod,
): LeaderboardAutoPublishRecord | null {
  return records.find((record) => record.userScopeKey === userScopeKey && record.period === period) ?? null;
}

export function shouldPublishLeaderboardPeriod({
  record,
  payloadKey,
  now,
  bypassMinInterval = false,
}: {
  readonly record: LeaderboardAutoPublishRecord | null;
  readonly payloadKey: string;
  readonly now: Date;
  readonly bypassMinInterval?: boolean;
}): LeaderboardAutoPublishDecision {
  if (!record) {
    return { shouldPublish: true, reason: "no_record", requiresRemoteOptInCheck: true };
  }

  const nowMs = now.getTime();
  const lastErrorMs = toTimestamp(record.lastErrorAt);
  if (lastErrorMs !== null && nowMs - lastErrorMs < LEADERBOARD_AUTO_PUBLISH_FAILURE_BACKOFF_MS) {
    return { shouldPublish: false, reason: "failure_backoff", requiresRemoteOptInCheck: false };
  }

  const lastSuccessMs = toTimestamp(record.lastSuccessAt);
  if (lastSuccessMs === null) {
    return { shouldPublish: true, reason: "no_record", requiresRemoteOptInCheck: true };
  }

  const successAgeMs = nowMs - lastSuccessMs;
  if (record.payloadKey === payloadKey) {
    if (successAgeMs >= LEADERBOARD_AUTO_PUBLISH_HEARTBEAT_MS) {
      return { shouldPublish: true, reason: "heartbeat_due", requiresRemoteOptInCheck: true };
    }
    return { shouldPublish: false, reason: "same_payload_recent", requiresRemoteOptInCheck: false };
  }

  if (!bypassMinInterval && successAgeMs < LEADERBOARD_AUTO_PUBLISH_MIN_SUCCESS_INTERVAL_MS) {
    return { shouldPublish: false, reason: "min_interval", requiresRemoteOptInCheck: false };
  }

  return {
    shouldPublish: true,
    reason: "payload_changed",
    requiresRemoteOptInCheck: bypassMinInterval || successAgeMs >= LEADERBOARD_AUTO_PUBLISH_HEARTBEAT_MS,
  };
}

export function upsertLeaderboardAutoPublishRecords(
  currentRecords: readonly LeaderboardAutoPublishRecord[],
  nextRecords: readonly LeaderboardAutoPublishRecord[],
): readonly LeaderboardAutoPublishRecord[] {
  const records = currentRecords.slice();
  for (const nextRecord of nextRecords) {
    const index = records.findIndex((record) => record.userScopeKey === nextRecord.userScopeKey && record.period === nextRecord.period);
    if (index === -1) {
      records.push(nextRecord);
    } else {
      records[index] = nextRecord;
    }
  }
  return records;
}

export function clearLeaderboardAutoPublishRecordsForUser(userScopeKey: string): void {
  const records = readLeaderboardAutoPublishRecords().filter((record) => record.userScopeKey !== userScopeKey);
  writeLeaderboardAutoPublishRecords(records);
}
