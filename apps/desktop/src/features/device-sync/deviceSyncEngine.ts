import type { SyncDeletionRecord, SyncedSegmentInput, SyncOutboxSegment, TrackerApi } from "@drifty/domain";
import type { DeviceSyncCycleReason, DeviceSyncStatus, SyncPushResponse } from "./deviceSyncTypes";

// Durable cursors live in tracker_meta so they survive reinstalls of the web
// layer and stay next to the data they index.
export const SYNC_PUSH_SEQ_KEY = "sync_push_seq";
export const SYNC_PULL_CURSOR_KEY = "sync_pull_cursor";
export const SYNC_DELETION_PULL_CURSOR_KEY = "sync_deletion_pull_cursor";
export const SYNC_DEVICE_ID_KEY = "sync_device_id";
export const SYNC_GENERATION_KEY = "sync_generation";
export const SYNC_ACCOUNT_ID_KEY = "sync_account_id";
export const SYNC_LAST_PUSHED_AT_KEY = "sync_last_pushed_at";
export const SYNC_LAST_PULLED_AT_KEY = "sync_last_pulled_at";

export const SYNC_PUSH_BATCH_LIMIT = 500;
export const SYNC_DELETION_BATCH_LIMIT = 200;
// Bounds one cycle's work so a huge initial backfill yields to the UI and
// resumes on the next trigger; the seq cursor makes resumption free.
export const SYNC_MAX_CHUNKS_PER_CYCLE = 40;
export const SYNC_CHUNK_YIELD_MS = 250;

export type SyncPullPage = {
  readonly segments: SyncedSegmentInput[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
};

export type SyncDeletionsPullPage = {
  readonly deletions: SyncDeletionRecord[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
};

export type DeviceSyncEngineDeps = {
  readonly tracker: Pick<
    TrackerApi,
    | "getSyncOutbox"
    | "getSyncState"
    | "setSyncState"
    | "getPendingSyncDeletions"
    | "markSyncDeletionsPushed"
    | "applySyncedSegments"
    | "applySyncedDeletions"
  >;
  readonly pushBatch: (
    segments: readonly SyncOutboxSegment[],
    deletions: readonly SyncDeletionRecord[],
    syncGeneration: number | null,
  ) => Promise<SyncPushResponse>;
  readonly fetchPullPage?: (cursor: string | null, excludeDeviceId: string | null) => Promise<SyncPullPage>;
  readonly fetchDeletionsPullPage?: (cursor: string | null, excludeDeviceId: string | null) => Promise<SyncDeletionsPullPage>;
  /** Resolves this desktop installation's cloud device id when nothing has been pushed yet. */
  readonly resolveDeviceId?: () => Promise<string | null>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  /** Prevents an in-flight cycle from writing state after the signed-in account changes. */
  readonly syncAccountId?: string;
  /** Re-checks the live auth owner after each awaited cloud request. */
  readonly isSyncAccountCurrent?: () => boolean;
  readonly syncExcludedApps?: (accountId: string) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSeq(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseSyncGeneration(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

function assertSyncAccount(
  snapshot: Awaited<ReturnType<TrackerApi["getSyncState"]>>,
  deps: Pick<DeviceSyncEngineDeps, "syncAccountId" | "isSyncAccountCurrent">,
  expectedGeneration?: number | null,
): void {
  if (
    (deps.syncAccountId && snapshot.state[SYNC_ACCOUNT_ID_KEY] !== deps.syncAccountId)
    || (expectedGeneration !== undefined && parseSyncGeneration(snapshot.state[SYNC_GENERATION_KEY]) !== expectedGeneration)
    || (deps.isSyncAccountCurrent && !deps.isSyncAccountCurrent())
  ) {
    throw new Error("Device sync account scope changed.");
  }
}

function accountBoundState(
  deps: Pick<DeviceSyncEngineDeps, "syncAccountId">,
  entries: Record<string, string | null>,
): Record<string, string | null> {
  return deps.syncAccountId ? { ...entries, [SYNC_ACCOUNT_ID_KEY]: deps.syncAccountId } : entries;
}

export async function runSyncPushCycle(deps: DeviceSyncEngineDeps, _reason: DeviceSyncCycleReason): Promise<DeviceSyncStatus> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());

  const snapshot = await deps.tracker.getSyncState();
  assertSyncAccount(snapshot, deps);
  let afterSeq = parseSeq(snapshot.state[SYNC_PUSH_SEQ_KEY]);
  let syncGeneration = parseSyncGeneration(snapshot.state[SYNC_GENERATION_KEY]);
  let deviceId = snapshot.state[SYNC_DEVICE_ID_KEY] ?? null;
  let lastPushedAt = snapshot.state[SYNC_LAST_PUSHED_AT_KEY] ?? null;
  let pendingPushCount = 0;

  for (let chunk = 0; chunk < SYNC_MAX_CHUNKS_PER_CYCLE; chunk += 1) {
    const outbox = await deps.tracker.getSyncOutbox({ afterSeq, limit: SYNC_PUSH_BATCH_LIMIT });
    const deletions = await deps.tracker.getPendingSyncDeletions(SYNC_DELETION_BATCH_LIMIT);
    pendingPushCount = outbox.pendingCount;
    if (outbox.items.length === 0 && deletions.length === 0) {
      break;
    }

    const response = await deps.pushBatch(outbox.items, deletions, syncGeneration);
    assertSyncAccount(await deps.tracker.getSyncState(), deps, syncGeneration);
    deviceId = response.deviceId;
    syncGeneration = response.syncGeneration;
    lastPushedAt = response.serverTime ?? now().toISOString();

    // Advance the cursor only past what the server actually accepted; the hot
    // segment keeps a higher seq and gets picked up once it goes cold.
    if (outbox.items.length > 0) {
      afterSeq = outbox.batchMaxSeq;
    }
    const entries: Record<string, string | null> = {
      [SYNC_PUSH_SEQ_KEY]: String(afterSeq),
      [SYNC_GENERATION_KEY]: String(syncGeneration),
      [SYNC_DEVICE_ID_KEY]: deviceId,
      [SYNC_LAST_PUSHED_AT_KEY]: lastPushedAt,
    };
    await deps.tracker.setSyncState(accountBoundState(deps, entries));
    assertSyncAccount(await deps.tracker.getSyncState(), deps, syncGeneration);
    if (deletions.length > 0) {
      await deps.tracker.markSyncDeletionsPushed(deletions.map((deletion) => deletion.deletionUid));
    }

    pendingPushCount = Math.max(0, outbox.pendingCount - outbox.items.length);
    const drained = outbox.items.length < SYNC_PUSH_BATCH_LIMIT && deletions.length < SYNC_DELETION_BATCH_LIMIT;
    if (drained) {
      break;
    }
    await sleep(SYNC_CHUNK_YIELD_MS);
  }

  return {
    enabled: true,
    deviceId,
    lastPushedAt,
    lastPulledAt: snapshot.state[SYNC_LAST_PULLED_AT_KEY] ?? null,
    pendingPushCount,
    backfill: {
      totalSeq: snapshot.counterSeq,
      pushedSeq: afterSeq,
    },
    lastError: null,
    lastErrorCode: null,
    lastErrorHttpStatus: null,
    lastErrorLockedReason: null,
  };
}

export type SyncPullResult = {
  readonly appliedCount: number;
  readonly lastPulledAt: string | null;
  readonly deviceId: string | null;
};

export async function runSyncPullCycle(deps: DeviceSyncEngineDeps): Promise<SyncPullResult> {
  const fetchPullPage = deps.fetchPullPage;
  if (!fetchPullPage) {
    return { appliedCount: 0, lastPulledAt: null, deviceId: null };
  }
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());

  const snapshot = await deps.tracker.getSyncState();
  assertSyncAccount(snapshot, deps);
  const scopeGeneration = parseSyncGeneration(snapshot.state[SYNC_GENERATION_KEY]);
  let deviceId: string | null = snapshot.state[SYNC_DEVICE_ID_KEY] ?? null;
  if (!deviceId && deps.resolveDeviceId) {
    deviceId = await deps.resolveDeviceId();
    assertSyncAccount(await deps.tracker.getSyncState(), deps, scopeGeneration);
    if (deviceId) {
      await deps.tracker.setSyncState(accountBoundState(deps, { [SYNC_DEVICE_ID_KEY]: deviceId }));
      assertSyncAccount(await deps.tracker.getSyncState(), deps, scopeGeneration);
    }
  }
  // Without a known own-device id the pull cannot exclude this device's rows, and
  // applying an echo would flip locally-originated segments to remote. Skip
  // until the id resolves (first push or a successful devices call).
  if (!deviceId) {
    return { appliedCount: 0, lastPulledAt: snapshot.state[SYNC_LAST_PULLED_AT_KEY] ?? null, deviceId: null };
  }

  let cursor: string | null = snapshot.state[SYNC_PULL_CURSOR_KEY] ?? null;
  let appliedCount = 0;
  let lastPulledAt: string | null = snapshot.state[SYNC_LAST_PULLED_AT_KEY] ?? null;

  for (let chunk = 0; chunk < SYNC_MAX_CHUNKS_PER_CYCLE; chunk += 1) {
    const page = await fetchPullPage(cursor, deviceId);
    assertSyncAccount(await deps.tracker.getSyncState(), deps, scopeGeneration);
    if (page.segments.length === 0) {
      break;
    }
    const result = await deps.tracker.applySyncedSegments(page.segments);
    assertSyncAccount(await deps.tracker.getSyncState(), deps, scopeGeneration);
    appliedCount += result.inserted + result.updated;
    cursor = page.nextCursor;
    lastPulledAt = now().toISOString();
    await deps.tracker.setSyncState(accountBoundState(deps, {
      [SYNC_PULL_CURSOR_KEY]: cursor,
      [SYNC_LAST_PULLED_AT_KEY]: lastPulledAt,
    }));
    assertSyncAccount(await deps.tracker.getSyncState(), deps, scopeGeneration);
    if (!page.hasMore) {
      break;
    }
    await sleep(SYNC_CHUNK_YIELD_MS);
  }

  // Deletions apply AFTER segments each cycle so a deleted range cannot be
  // resurrected by segment pages that were read before the tombstone.
  if (deps.fetchDeletionsPullPage) {
    let deletionCursor: string | null = snapshot.state[SYNC_DELETION_PULL_CURSOR_KEY] ?? null;
    for (let chunk = 0; chunk < SYNC_MAX_CHUNKS_PER_CYCLE; chunk += 1) {
      const page = await deps.fetchDeletionsPullPage(deletionCursor, deviceId);
      assertSyncAccount(await deps.tracker.getSyncState(), deps, scopeGeneration);
      if (page.deletions.length === 0) {
        break;
      }
      const result = await deps.tracker.applySyncedDeletions(page.deletions);
      assertSyncAccount(await deps.tracker.getSyncState(), deps, scopeGeneration);
      appliedCount += result.applied;
      deletionCursor = page.nextCursor;
      lastPulledAt = now().toISOString();
      await deps.tracker.setSyncState(accountBoundState(deps, {
        [SYNC_DELETION_PULL_CURSOR_KEY]: deletionCursor,
        [SYNC_LAST_PULLED_AT_KEY]: lastPulledAt,
      }));
      assertSyncAccount(await deps.tracker.getSyncState(), deps, scopeGeneration);
      if (!page.hasMore) {
        break;
      }
      await sleep(SYNC_CHUNK_YIELD_MS);
    }
  }

  return { appliedCount, lastPulledAt, deviceId };
}

export type SyncCycleResult = {
  readonly status: DeviceSyncStatus;
  readonly pulledCount: number;
};

export async function runSyncCycle(deps: DeviceSyncEngineDeps, reason: DeviceSyncCycleReason): Promise<SyncCycleResult> {
  if (deps.syncAccountId && deps.syncExcludedApps) {
    assertSyncAccount(await deps.tracker.getSyncState(), deps);
    await deps.syncExcludedApps(deps.syncAccountId);
    assertSyncAccount(await deps.tracker.getSyncState(), deps);
  }
  const pushStatus = await runSyncPushCycle(deps, reason);
  const pull = await runSyncPullCycle(deps);
  return {
    status: {
      ...pushStatus,
      deviceId: pull.deviceId ?? pushStatus.deviceId,
      lastPulledAt: pull.lastPulledAt ?? pushStatus.lastPulledAt,
    },
    pulledCount: pull.appliedCount,
  };
}
