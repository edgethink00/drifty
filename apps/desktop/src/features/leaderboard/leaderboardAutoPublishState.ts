import type { LeaderboardPeriod } from "./leaderboardService";

export const LEADERBOARD_AUTO_PUBLISH_STORAGE_KEY = "drifty.leaderboardAutoPublish.v1";
// Score changes publish at most once per wall-clock hour "slot". The public
// leaderboard only exposes an hour-truncated `updated_at`, so a slot finer than
// one hour would let observers reconstruct sub-hour activity timing from score
// deltas, while a coarser slot would waste freshness. Publishing is additionally
// aligned to slot boundaries by the controller's timer so the publish moment
// itself never leaks sub-hour timing. See
// docs/plans/leaderboard-hourly-publish-20260710.md.
export const LEADERBOARD_AUTO_PUBLISH_SLOT_MS = 60 * 60 * 1000;
// Even when the payload is unchanged, republish once a day so the server-side
// freshness window keeps the row visible on the board.
export const LEADERBOARD_AUTO_PUBLISH_HEARTBEAT_MS = 24 * 60 * 60 * 1000;
export const LEADERBOARD_AUTO_PUBLISH_FAILURE_BACKOFF_MS = 15 * 60 * 1000;

const LEADERBOARD_AUTO_PUBLISH_PERIODS = ["daily", "weekly", "monthly"] as const satisfies readonly LeaderboardPeriod[];

function leaderboardAutoPublishSlotIndex(ms: number): number {
  return Math.floor(ms / LEADERBOARD_AUTO_PUBLISH_SLOT_MS);
}

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
  | "same_slot"
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
  bypassSlotGate = false,
}: {
  readonly record: LeaderboardAutoPublishRecord | null;
  readonly payloadKey: string;
  readonly now: Date;
  readonly bypassSlotGate?: boolean;
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

  // Payload changed. Publish at most once per wall-clock hour slot so the public
  // leaderboard's hour-truncated `updated_at` (and score deltas between polls)
  // can never reveal sub-hour activity timing. Explicit user actions — joining or
  // deleting history — pass bypassSlotGate to skip the slot gate.
  if (!bypassSlotGate && leaderboardAutoPublishSlotIndex(nowMs) <= leaderboardAutoPublishSlotIndex(lastSuccessMs)) {
    return { shouldPublish: false, reason: "same_slot", requiresRemoteOptInCheck: false };
  }

  // Always re-verify remote opt-in before publishing a changed score. This must
  // stay decoupled from publish frequency: under the hourly slot gate an active
  // user republishes every hour, which resets lastSuccessAt so a heartbeat-based
  // recheck would never fire — letting an always-on device silently resurrect an
  // opt-out the user made on another device (publishOwnFocusTotal re-upserts
  // opted_in=true). Rechecking on every real publish restores the pre-slot-gate
  // guarantee.
  return {
    shouldPublish: true,
    reason: "payload_changed",
    requiresRemoteOptInCheck: true,
  };
}

export function shouldSkipLeaderboardAutoPublishPayloadBuild({
  records,
  userScopeKey,
  now,
  bypassSlotGate = false,
}: {
  readonly records: readonly LeaderboardAutoPublishRecord[];
  readonly userScopeKey: string;
  readonly now: Date;
  readonly bypassSlotGate?: boolean;
}): boolean {
  if (bypassSlotGate) return false;

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return false;

  return LEADERBOARD_AUTO_PUBLISH_PERIODS.every((period) => {
    const record = findLeaderboardAutoPublishRecord(records, userScopeKey, period);
    if (!record) return false;

    const lastErrorMs = toTimestamp(record.lastErrorAt);
    if (
      lastErrorMs !== null
      && nowMs >= lastErrorMs
      && nowMs - lastErrorMs < LEADERBOARD_AUTO_PUBLISH_FAILURE_BACKOFF_MS
    ) {
      return true;
    }

    const lastSuccessMs = toTimestamp(record.lastSuccessAt);
    if (lastSuccessMs === null || nowMs < lastSuccessMs) return false;

    const successAgeMs = nowMs - lastSuccessMs;
    return successAgeMs < LEADERBOARD_AUTO_PUBLISH_HEARTBEAT_MS
      && leaderboardAutoPublishSlotIndex(nowMs) <= leaderboardAutoPublishSlotIndex(lastSuccessMs);
  });
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
