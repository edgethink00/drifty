import type { DeviceSyncCycleReason } from "./deviceSyncTypes";

// Pacing state only — the durable push/pull cursors live in tracker_meta on the
// sidecar side (see deviceSyncEngine), so localStorage here just prevents
// hammering the edge function after failures. Mirrors the leaderboard
// auto-publish state machine (leaderboardAutoPublishState.ts).
export const DEVICE_SYNC_STATE_STORAGE_KEY = "drifty.deviceSync.state.v1";
export const DEVICE_SYNC_ACCOUNT_RESET_PENDING_STORAGE_KEY = "drifty.deviceSync.accountResetPending.v1";
export const DEVICE_SYNC_FAILURE_BACKOFF_MS = 15 * 60 * 1000;
export const DEVICE_SYNC_MIN_CYCLE_INTERVAL_MS = 60 * 1000;

export type DeviceSyncCycleRecord = {
  readonly userScopeKey: string;
  readonly lastAttemptAt: string;
  readonly lastSuccessAt: string | null;
  readonly lastErrorAt: string | null;
};

export type DeviceSyncCycleDecision = {
  readonly shouldRun: boolean;
  readonly reason: "no_record" | "due" | "manual" | "failure_backoff" | "too_soon";
};

export type DeviceSyncAccountResetPendingRecord = {
  readonly userScopeKey: string | null;
};

function getStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function parseRecord(value: unknown): DeviceSyncCycleRecord | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("userScopeKey" in value) || !("lastAttemptAt" in value) || !("lastSuccessAt" in value) || !("lastErrorAt" in value)) {
    return null;
  }
  const lastSuccessAt = nullableString(value.lastSuccessAt);
  const lastErrorAt = nullableString(value.lastErrorAt);
  if (
    typeof value.userScopeKey !== "string" ||
    typeof value.lastAttemptAt !== "string" ||
    lastSuccessAt === undefined ||
    lastErrorAt === undefined
  ) {
    return null;
  }
  return { userScopeKey: value.userScopeKey, lastAttemptAt: value.lastAttemptAt, lastSuccessAt, lastErrorAt };
}

function parseStoredRecords(value: string | null): readonly DeviceSyncCycleRecord[] {
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

export function readDeviceSyncCycleRecords(): readonly DeviceSyncCycleRecord[] {
  const storage = getStorage();
  if (!storage) return [];
  return parseStoredRecords(storage.getItem(DEVICE_SYNC_STATE_STORAGE_KEY));
}

export function writeDeviceSyncCycleRecords(records: readonly DeviceSyncCycleRecord[]): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(DEVICE_SYNC_STATE_STORAGE_KEY, JSON.stringify(records));
}

export function findDeviceSyncCycleRecord(
  records: readonly DeviceSyncCycleRecord[],
  userScopeKey: string,
): DeviceSyncCycleRecord | null {
  return records.find((record) => record.userScopeKey === userScopeKey) ?? null;
}

export function upsertDeviceSyncCycleRecord(
  records: readonly DeviceSyncCycleRecord[],
  next: DeviceSyncCycleRecord,
): readonly DeviceSyncCycleRecord[] {
  const copy = records.slice();
  const index = copy.findIndex((record) => record.userScopeKey === next.userScopeKey);
  if (index === -1) copy.push(next);
  else copy[index] = next;
  return copy;
}

export function shouldRunDeviceSyncCycle({
  record,
  now,
  reason,
}: {
  readonly record: DeviceSyncCycleRecord | null;
  readonly now: Date;
  readonly reason: DeviceSyncCycleReason;
}): DeviceSyncCycleDecision {
  if (reason === "manual") {
    return { shouldRun: true, reason: "manual" };
  }
  if (!record) {
    return { shouldRun: true, reason: "no_record" };
  }
  const nowMs = now.getTime();
  const lastErrorMs = toTimestamp(record.lastErrorAt);
  if (lastErrorMs !== null && nowMs - lastErrorMs < DEVICE_SYNC_FAILURE_BACKOFF_MS) {
    return { shouldRun: false, reason: "failure_backoff" };
  }
  const lastAttemptMs = toTimestamp(record.lastAttemptAt);
  if (lastAttemptMs !== null && nowMs - lastAttemptMs < DEVICE_SYNC_MIN_CYCLE_INTERVAL_MS) {
    return { shouldRun: false, reason: "too_soon" };
  }
  return { shouldRun: true, reason: "due" };
}

export function clearDeviceSyncCycleRecordsForUser(userScopeKey: string): void {
  writeDeviceSyncCycleRecords(readDeviceSyncCycleRecords().filter((record) => record.userScopeKey !== userScopeKey));
}

export function hasPendingDeviceSyncAccountReset(): boolean {
  return readPendingDeviceSyncAccountReset() !== null;
}

export function readPendingDeviceSyncAccountReset(): DeviceSyncAccountResetPendingRecord | null {
  const value = getStorage()?.getItem(DEVICE_SYNC_ACCOUNT_RESET_PENDING_STORAGE_KEY) ?? null;
  if (!value) return null;
  // Preserve recovery for the original marker written by preview builds.
  if (value === "1") return { userScopeKey: null };
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || !("userScopeKey" in parsed)) {
      return { userScopeKey: null };
    }
    return parsed.userScopeKey === null || typeof parsed.userScopeKey === "string"
      ? { userScopeKey: parsed.userScopeKey }
      : { userScopeKey: null };
  } catch {
    // A non-empty but unreadable guard is still evidence that a reset may have
    // been interrupted. Fail closed and clear the global tracker identity even
    // though the original user-scoped pacing record cannot be identified.
    return { userScopeKey: null };
  }
}

export function markDeviceSyncAccountResetPending(userScopeKey: string | null = null): void {
  getStorage()?.setItem(
    DEVICE_SYNC_ACCOUNT_RESET_PENDING_STORAGE_KEY,
    JSON.stringify({ userScopeKey }),
  );
}

export function clearPendingDeviceSyncAccountReset(): void {
  getStorage()?.removeItem(DEVICE_SYNC_ACCOUNT_RESET_PENDING_STORAGE_KEY);
}
