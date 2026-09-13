import type { DeviceSyncCycleReason } from "./deviceSyncTypes";

// Pacing state only — the durable push/pull cursors live in tracker_meta on the
// sidecar side (see deviceSyncEngine), so localStorage here just prevents
// hammering the edge function after failures. Mirrors the leaderboard
// auto-publish state machine (leaderboardAutoPublishState.ts).
export const DEVICE_SYNC_STATE_STORAGE_KEY = "drifty.deviceSync.state.v1";
export const DEVICE_SYNC_ACCOUNT_RESET_PENDING_STORAGE_KEY = "drifty.deviceSync.accountResetPending.v1";
/** Maximum and permanent-failure automatic retry delay. Manual retries bypass it. */
export const DEVICE_SYNC_FAILURE_BACKOFF_MS = 15 * 60 * 1000;
export const DEVICE_SYNC_TRANSIENT_BACKOFF_BASE_MS = 60 * 1000;
export const DEVICE_SYNC_MIN_CYCLE_INTERVAL_MS = 60 * 1000;

export type DeviceSyncCycleRecord = {
  readonly userScopeKey: string;
  readonly lastAttemptAt: string;
  readonly lastSuccessAt: string | null;
  readonly lastErrorAt: string | null;
  /** Optional for compatibility with records written by earlier builds. */
  readonly consecutiveFailureCount?: number;
  readonly lastErrorCode?: string | null;
  readonly lastErrorHttpStatus?: number | null;
  readonly lastErrorLockedReason?: string | null;
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

function optionalNullableString(value: unknown): string | null | undefined {
  return value === undefined ? undefined : nullableString(value);
}

function optionalNullableHttpStatus(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value;
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : undefined;
}

function optionalFailureCount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function parseRecord(value: unknown): DeviceSyncCycleRecord | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("userScopeKey" in value) || !("lastAttemptAt" in value) || !("lastSuccessAt" in value) || !("lastErrorAt" in value)) {
    return null;
  }
  const lastSuccessAt = nullableString(value.lastSuccessAt);
  const lastErrorAt = nullableString(value.lastErrorAt);
  const consecutiveFailureCount = optionalFailureCount("consecutiveFailureCount" in value ? value.consecutiveFailureCount : undefined);
  const lastErrorCode = optionalNullableString("lastErrorCode" in value ? value.lastErrorCode : undefined);
  const lastErrorHttpStatus = optionalNullableHttpStatus("lastErrorHttpStatus" in value ? value.lastErrorHttpStatus : undefined);
  const lastErrorLockedReason = optionalNullableString("lastErrorLockedReason" in value ? value.lastErrorLockedReason : undefined);
  if (
    typeof value.userScopeKey !== "string" ||
    typeof value.lastAttemptAt !== "string" ||
    lastSuccessAt === undefined ||
    lastErrorAt === undefined ||
    ("consecutiveFailureCount" in value && consecutiveFailureCount === undefined) ||
    ("lastErrorCode" in value && lastErrorCode === undefined) ||
    ("lastErrorHttpStatus" in value && lastErrorHttpStatus === undefined) ||
    ("lastErrorLockedReason" in value && lastErrorLockedReason === undefined)
  ) {
    return null;
  }
  return {
    userScopeKey: value.userScopeKey,
    lastAttemptAt: value.lastAttemptAt,
    lastSuccessAt,
    lastErrorAt,
    ...(consecutiveFailureCount === undefined ? {} : { consecutiveFailureCount }),
    ...(lastErrorCode === undefined ? {} : { lastErrorCode }),
    ...(lastErrorHttpStatus === undefined ? {} : { lastErrorHttpStatus }),
    ...(lastErrorLockedReason === undefined ? {} : { lastErrorLockedReason }),
  };
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
  const failureBackoffMs = getDeviceSyncFailureBackoffMs(record);
  if (lastErrorMs !== null && nowMs - lastErrorMs < failureBackoffMs) {
    return { shouldRun: false, reason: "failure_backoff" };
  }
  const lastAttemptMs = toTimestamp(record.lastAttemptAt);
  if (lastAttemptMs !== null && nowMs - lastAttemptMs < DEVICE_SYNC_MIN_CYCLE_INTERVAL_MS) {
    return { shouldRun: false, reason: "too_soon" };
  }
  return { shouldRun: true, reason: "due" };
}

export function getDeviceSyncFailureBackoffMs(record: DeviceSyncCycleRecord): number {
  if (!record.lastErrorAt) return 0;
  const status = record.lastErrorHttpStatus;
  const code = record.lastErrorCode;
  const isRetryableHttp = status === null
    || status === undefined
    || status === 408
    || status === 425
    || status === 429
    || (typeof status === "number" && status >= 500);
  const isStoppedState = code === "sync_paused" || code === "sync_generation_mismatch" || code === "sync_account_changed";
  if (!isRetryableHttp || isStoppedState || status === 429) return DEVICE_SYNC_FAILURE_BACKOFF_MS;
  const failureCount = Math.max(1, record.consecutiveFailureCount ?? 1);
  return Math.min(
    DEVICE_SYNC_FAILURE_BACKOFF_MS,
    DEVICE_SYNC_TRANSIENT_BACKOFF_BASE_MS * (2 ** Math.min(failureCount - 1, 8)),
  );
}

export function getDeviceSyncNextAutomaticAttemptAt(record: DeviceSyncCycleRecord | null): string | null {
  if (!record) return null;
  const lastErrorMs = toTimestamp(record.lastErrorAt);
  if (lastErrorMs !== null) return new Date(lastErrorMs + getDeviceSyncFailureBackoffMs(record)).toISOString();
  const lastAttemptMs = toTimestamp(record.lastAttemptAt);
  return lastAttemptMs === null ? null : new Date(lastAttemptMs + DEVICE_SYNC_MIN_CYCLE_INTERVAL_MS).toISOString();
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
