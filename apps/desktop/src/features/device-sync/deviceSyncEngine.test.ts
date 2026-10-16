import { describe, expect, it, vi } from "vitest";
import type { SyncDeletionRecord, SyncOutboxPage, SyncOutboxSegment, SyncStateSnapshot } from "@drifty/domain";
import {
  SYNC_ACCOUNT_ID_KEY,
  SYNC_DEVICE_ID_KEY,
  SYNC_GENERATION_KEY,
  SYNC_PUSH_BATCH_LIMIT,
  SYNC_PUSH_SEQ_KEY,
  runSyncPullCycle,
  runSyncPushCycle,
  runSyncCycle,
  type DeviceSyncEngineDeps,
} from "./deviceSyncEngine";

describe("runSyncCycle exclusion account boundary", () => {
  it("rejects a stale account before touching exclusions", async () => {
    const { tracker } = makeTracker({
      snapshot: emptySnapshot({ [SYNC_ACCOUNT_ID_KEY]: "user-2" }),
      outboxPages: [],
    });
    const syncExcludedApps = vi.fn();
    const pushBatch = vi.fn();
    await expect(runSyncCycle({ tracker, pushBatch, syncAccountId: "user-1", syncExcludedApps }, "manual"))
      .rejects.toThrow("account scope changed");
    expect(syncExcludedApps).not.toHaveBeenCalled();
    expect(pushBatch).not.toHaveBeenCalled();
  });

  it("does not push history after the account changes during exclusion sync", async () => {
    const { tracker } = makeTracker({
      snapshot: emptySnapshot({ [SYNC_ACCOUNT_ID_KEY]: "user-1" }),
      outboxPages: [],
    });
    const pushBatch = vi.fn();
    await expect(runSyncCycle({
      tracker, pushBatch, syncAccountId: "user-1",
      syncExcludedApps: async () => { await tracker.setSyncState({ [SYNC_ACCOUNT_ID_KEY]: "user-2" }); },
    }, "manual")).rejects.toThrow("account scope changed");
    expect(pushBatch).not.toHaveBeenCalled();
  });

  it("keeps syncing activity when the category definitions pass fails", async () => {
    const { tracker } = makeTracker({
      snapshot: emptySnapshot({ [SYNC_ACCOUNT_ID_KEY]: "user-1" }),
      outboxPages: [{ items: [], batchMaxSeq: 0, counterSeq: 0, pendingCount: 0 }],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const syncCategoryDefinitions = vi.fn().mockRejectedValue(new Error("relation does not exist"));
    await expect(runSyncCycle({ tracker, pushBatch: vi.fn(), syncAccountId: "user-1", syncCategoryDefinitions }, "manual")).resolves.toBeTruthy();
    expect(syncCategoryDefinitions).toHaveBeenCalledWith("user-1");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("syncs projects and rules after the category definitions and keeps activity sync when that pass fails", async () => {
    const { tracker } = makeTracker({
      snapshot: emptySnapshot({ [SYNC_ACCOUNT_ID_KEY]: "user-1" }),
      outboxPages: [{ items: [], batchMaxSeq: 0, counterSeq: 0, pendingCount: 0 }],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const order: string[] = [];
    const syncCategoryDefinitions = vi.fn(async () => { order.push("categories"); });
    const syncProjectRuleDefinitions = vi.fn(async () => { order.push("projects and rules"); throw new Error("relation does not exist"); });
    await expect(runSyncCycle({ tracker, pushBatch: vi.fn(), syncAccountId: "user-1", syncCategoryDefinitions, syncProjectRuleDefinitions }, "manual")).resolves.toBeTruthy();
    expect(order).toEqual(["categories", "projects and rules"]);
    expect(syncProjectRuleDefinitions).toHaveBeenCalledWith("user-1");
    warn.mockRestore();
  });

  it("does not push history after the account changes during the category definitions pass", async () => {
    const { tracker } = makeTracker({
      snapshot: emptySnapshot({ [SYNC_ACCOUNT_ID_KEY]: "user-1" }),
      outboxPages: [],
    });
    const pushBatch = vi.fn();
    await expect(runSyncCycle({
      tracker, pushBatch, syncAccountId: "user-1",
      syncCategoryDefinitions: async () => { await tracker.setSyncState({ [SYNC_ACCOUNT_ID_KEY]: "user-2" }); throw new Error("Device sync account scope changed."); },
    }, "manual")).rejects.toThrow("account scope changed");
    expect(pushBatch).not.toHaveBeenCalled();
  });
});

function outboxSegment(syncSeq: number): SyncOutboxSegment {
  return {
    segmentUid: `uid-${syncSeq}`,
    startedAt: "2026-07-06T09:00:00+00:00",
    endedAt: "2026-07-06T09:01:00+00:00",
    durationSeconds: 60,
    appName: "Code",
    platform: "macos",
    source: "accessibility",
    syncSeq,
    classification: null,
  };
}

function emptySnapshot(state: Record<string, string> = {}, counterSeq = 0): SyncStateSnapshot {
  return { state, counterSeq, pendingDeletions: 0 };
}

type TrackerStub = DeviceSyncEngineDeps["tracker"];

function makeTracker({
  snapshot,
  subsequentSnapshot,
  outboxPages,
  deletions = [],
}: {
  snapshot: SyncStateSnapshot;
  subsequentSnapshot?: SyncStateSnapshot;
  outboxPages: SyncOutboxPage[];
  deletions?: SyncDeletionRecord[][];
}) {
  let outboxCall = 0;
  let deletionCall = 0;
  let currentState = { ...snapshot.state };
  const setSyncState = vi.fn(async (entries: Record<string, string | null>) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === null) delete currentState[key];
      else currentState[key] = value;
    }
    return { written: 1 };
  });
  const markSyncDeletionsPushed = vi.fn(async () => ({ marked: 0 }));
  const applySyncedSegments = vi.fn(async (segments: unknown[]) => ({ inserted: segments.length, updated: 0, skipped: 0 }));
  const applySyncedDeletions = vi.fn(async (items: unknown[]) => ({ applied: items.length, skipped: 0 }));
  let syncStateCall = 0;
  const tracker: TrackerStub = {
    getSyncState: async () => {
      syncStateCall += 1;
      return syncStateCall > 1 && subsequentSnapshot
        ? subsequentSnapshot
        : { ...snapshot, state: { ...currentState } };
    },
    getSyncOutbox: async () => {
      const page = outboxPages[Math.min(outboxCall, outboxPages.length - 1)];
      outboxCall += 1;
      return page;
    },
    getPendingSyncDeletions: async () => {
      const batch = deletions[Math.min(deletionCall, Math.max(0, deletions.length - 1))] ?? [];
      deletionCall += 1;
      return batch;
    },
    setSyncState,
    markSyncDeletionsPushed,
    applySyncedSegments,
    applySyncedDeletions,
  };
  return { tracker, setSyncState, markSyncDeletionsPushed, applySyncedSegments, applySyncedDeletions };
}

describe("runSyncPushCycle", () => {
  it("pushes the outbox and advances the cursor to batchMaxSeq only", async () => {
    const { tracker, setSyncState } = makeTracker({
      snapshot: emptySnapshot({}, 12),
      outboxPages: [
        { items: [outboxSegment(1), outboxSegment(2)], batchMaxSeq: 2, counterSeq: 12, pendingCount: 2 },
        { items: [], batchMaxSeq: 2, counterSeq: 12, pendingCount: 0 },
      ],
    });
    const pushBatch = vi.fn(async () => ({
      deviceId: "device-1",
      syncGeneration: 1,
      acceptedSegments: 2,
      acceptedDeletions: 0,
      serverTime: "2026-07-09T00:00:00+00:00",
    }));

    const status = await runSyncPushCycle({ tracker, pushBatch, sleep: async () => {} }, "startup");

    expect(pushBatch).toHaveBeenCalledTimes(1);
    expect(pushBatch).toHaveBeenCalledWith(expect.any(Array), expect.any(Array), null);
    expect(setSyncState).toHaveBeenCalledWith(
      expect.objectContaining({
        [SYNC_PUSH_SEQ_KEY]: "2",
        [SYNC_DEVICE_ID_KEY]: "device-1",
        [SYNC_GENERATION_KEY]: "1",
      }),
    );
    expect(status.deviceId).toBe("device-1");
    expect(status.lastPushedAt).toBe("2026-07-09T00:00:00+00:00");
    // counterSeq 12 vs pushed 2 → backfill progress is visible.
    expect(status.backfill).toEqual({ totalSeq: 12, pushedSeq: 2 });
  });

  it("keeps chunking until the outbox is drained", async () => {
    const fullPage: SyncOutboxPage = {
      items: Array.from({ length: SYNC_PUSH_BATCH_LIMIT }, (_, index) => outboxSegment(index + 1)),
      batchMaxSeq: SYNC_PUSH_BATCH_LIMIT,
      counterSeq: SYNC_PUSH_BATCH_LIMIT + 3,
      pendingCount: SYNC_PUSH_BATCH_LIMIT + 3,
    };
    const finalPage: SyncOutboxPage = {
      items: [outboxSegment(SYNC_PUSH_BATCH_LIMIT + 3)],
      batchMaxSeq: SYNC_PUSH_BATCH_LIMIT + 3,
      counterSeq: SYNC_PUSH_BATCH_LIMIT + 3,
      pendingCount: 1,
    };
    const { tracker } = makeTracker({
      snapshot: emptySnapshot(),
      outboxPages: [fullPage, finalPage, { items: [], batchMaxSeq: 0, counterSeq: 0, pendingCount: 0 }],
    });
    const pushBatch = vi.fn(async () => ({
      deviceId: "device-1",
      syncGeneration: 1,
      acceptedSegments: 1,
      acceptedDeletions: 0,
      serverTime: "2026-07-09T00:00:00+00:00",
    }));

    await runSyncPushCycle({ tracker, pushBatch, sleep: async () => {} }, "interval");

    expect(pushBatch).toHaveBeenCalledTimes(2);
  });

  it("marks deletions pushed only after the server accepted them", async () => {
    const deletion: SyncDeletionRecord = {
      deletionUid: "del-1",
      kind: "range",
      rangeStart: "2026-07-06T00:00:00+00:00",
      rangeEnd: "2026-07-06T23:59:59+00:00",
      createdAt: "2026-07-06T10:00:00+00:00",
    };
    const { tracker, markSyncDeletionsPushed } = makeTracker({
      snapshot: emptySnapshot(),
      outboxPages: [{ items: [], batchMaxSeq: 0, counterSeq: 0, pendingCount: 0 }],
      deletions: [[deletion], []],
    });
    const pushBatch = vi.fn(async () => ({
      deviceId: "device-1",
      syncGeneration: 1,
      acceptedSegments: 0,
      acceptedDeletions: 1,
      serverTime: "2026-07-09T00:00:00+00:00",
    }));

    await runSyncPushCycle({ tracker, pushBatch, sleep: async () => {} }, "interval");

    expect(pushBatch).toHaveBeenCalledTimes(1);
    expect(markSyncDeletionsPushed).toHaveBeenCalledWith(["del-1"]);
  });

  it("leaves the cursor untouched when the push fails", async () => {
    const { tracker, setSyncState, markSyncDeletionsPushed } = makeTracker({
      snapshot: emptySnapshot({ [SYNC_PUSH_SEQ_KEY]: "5" }),
      outboxPages: [{ items: [outboxSegment(6)], batchMaxSeq: 6, counterSeq: 6, pendingCount: 1 }],
    });
    const pushBatch = vi.fn(async () => {
      throw new Error("HTTP 402");
    });

    await expect(runSyncPushCycle({ tracker, pushBatch, sleep: async () => {} }, "interval")).rejects.toThrow("HTTP 402");
    expect(setSyncState).not.toHaveBeenCalled();
    expect(markSyncDeletionsPushed).not.toHaveBeenCalled();
  });

  it("sends and preserves the account sync generation after a purge barrier exists", async () => {
    const { tracker, setSyncState } = makeTracker({
      snapshot: emptySnapshot({ [SYNC_PUSH_SEQ_KEY]: "5", [SYNC_GENERATION_KEY]: "3" }, 6),
      outboxPages: [{ items: [outboxSegment(6)], batchMaxSeq: 6, counterSeq: 6, pendingCount: 1 }],
    });
    const pushBatch = vi.fn(async () => ({
      deviceId: "device-1",
      syncGeneration: 3,
      acceptedSegments: 1,
      acceptedDeletions: 0,
      serverTime: "2026-07-09T00:00:00+00:00",
    }));

    await runSyncPushCycle({ tracker, pushBatch, sleep: async () => {} }, "manual");

    expect(pushBatch).toHaveBeenCalledWith(expect.any(Array), expect.any(Array), 3);
    expect(setSyncState).toHaveBeenCalledWith(expect.objectContaining({ [SYNC_GENERATION_KEY]: "3" }));
  });

  it("does not advance a cursor when the account scope changes while a push is in flight", async () => {
    const { tracker, setSyncState } = makeTracker({
      snapshot: emptySnapshot({ [SYNC_ACCOUNT_ID_KEY]: "user-1" }, 1),
      subsequentSnapshot: emptySnapshot({ [SYNC_ACCOUNT_ID_KEY]: "user-2" }, 1),
      outboxPages: [{ items: [outboxSegment(1)], batchMaxSeq: 1, counterSeq: 1, pendingCount: 1 }],
    });
    const pushBatch = vi.fn(async () => ({
      deviceId: "device-1",
      syncGeneration: 1,
      acceptedSegments: 1,
      acceptedDeletions: 0,
      serverTime: "2026-07-09T00:00:00+00:00",
    }));

    await expect(runSyncPushCycle({ tracker, pushBatch, syncAccountId: "user-1" }, "manual"))
      .rejects.toThrow("account scope changed");
    expect(setSyncState).not.toHaveBeenCalled();
  });

  it("does not advance a cursor when live auth changes while a push is in flight", async () => {
    const { tracker, setSyncState } = makeTracker({
      snapshot: emptySnapshot({ [SYNC_ACCOUNT_ID_KEY]: "user-1" }, 1),
      outboxPages: [{ items: [outboxSegment(1)], batchMaxSeq: 1, counterSeq: 1, pendingCount: 1 }],
    });
    let currentAccount = true;
    const pushBatch = vi.fn(async () => {
      currentAccount = false;
      return {
        deviceId: "device-1",
        syncGeneration: 1,
        acceptedSegments: 1,
        acceptedDeletions: 0,
        serverTime: "2026-07-09T00:00:00+00:00",
      };
    });

    await expect(runSyncPushCycle({
      tracker,
      pushBatch,
      syncAccountId: "user-1",
      isSyncAccountCurrent: () => currentAccount,
    }, "manual")).rejects.toThrow("account scope changed");
    expect(setSyncState).not.toHaveBeenCalled();
  });

  it("does nothing when the outbox and deletion queue are empty", async () => {
    const { tracker, setSyncState } = makeTracker({
      snapshot: emptySnapshot({ [SYNC_PUSH_SEQ_KEY]: "9", [SYNC_DEVICE_ID_KEY]: "device-1" }, 9),
      outboxPages: [{ items: [], batchMaxSeq: 9, counterSeq: 9, pendingCount: 0 }],
    });
    const pushBatch = vi.fn();

    const status = await runSyncPushCycle({ tracker, pushBatch, sleep: async () => {} }, "focus");

    expect(pushBatch).not.toHaveBeenCalled();
    expect(setSyncState).not.toHaveBeenCalled();
    expect(status.deviceId).toBe("device-1");
    expect(status.pendingPushCount).toBe(0);
  });
});

describe("runSyncPullCycle", () => {
  it("does not apply fetched rows after live auth changes", async () => {
    const { tracker, applySyncedSegments, setSyncState } = makeTracker({
      snapshot: emptySnapshot({
        [SYNC_ACCOUNT_ID_KEY]: "user-1",
        [SYNC_DEVICE_ID_KEY]: "device-1",
      }),
      outboxPages: [{ items: [], batchMaxSeq: 0, counterSeq: 0, pendingCount: 0 }],
    });
    let currentAccount = true;

    await expect(runSyncPullCycle({
      tracker,
      pushBatch: vi.fn(),
      syncAccountId: "user-1",
      isSyncAccountCurrent: () => currentAccount,
      fetchPullPage: async () => {
        currentAccount = false;
        return {
          segments: [{
            segmentUid: "remote-1",
            originDeviceId: "device-2",
            startedAt: "2026-07-06T09:00:00+00:00",
            endedAt: "2026-07-06T09:01:00+00:00",
            durationSeconds: 60,
            appName: "Code",
            platform: "macos",
            source: "accessibility",
            classification: null,
          }],
          nextCursor: "cursor-1",
          hasMore: false,
        };
      },
    })).rejects.toThrow("account scope changed");
    expect(applySyncedSegments).not.toHaveBeenCalled();
    expect(setSyncState).not.toHaveBeenCalled();
  });

  it("does not apply a page fetched for an older purge generation", async () => {
    const { tracker, applySyncedSegments, setSyncState } = makeTracker({
      snapshot: emptySnapshot({
        [SYNC_ACCOUNT_ID_KEY]: "user-1",
        [SYNC_DEVICE_ID_KEY]: "device-1",
        [SYNC_GENERATION_KEY]: "1",
      }),
      subsequentSnapshot: emptySnapshot({
        [SYNC_ACCOUNT_ID_KEY]: "user-1",
        [SYNC_DEVICE_ID_KEY]: "device-1",
        [SYNC_GENERATION_KEY]: "2",
      }),
      outboxPages: [{ items: [], batchMaxSeq: 0, counterSeq: 0, pendingCount: 0 }],
    });

    await expect(runSyncPullCycle({
      tracker,
      pushBatch: vi.fn(),
      syncAccountId: "user-1",
      fetchPullPage: async () => ({
        segments: [{
          segmentUid: "remote-stale",
          originDeviceId: "device-2",
          startedAt: "2026-07-06T09:00:00+00:00",
          endedAt: "2026-07-06T09:01:00+00:00",
          durationSeconds: 60,
          appName: "Code",
          platform: "macos",
          source: "accessibility",
          classification: null,
        }],
        nextCursor: "cursor-stale",
        hasMore: false,
      }),
    })).rejects.toThrow("account scope changed");
    expect(applySyncedSegments).not.toHaveBeenCalled();
    expect(setSyncState).not.toHaveBeenCalled();
  });
});
