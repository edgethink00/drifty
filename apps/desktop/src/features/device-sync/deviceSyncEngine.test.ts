import { describe, expect, it, vi } from "vitest";
import type { SyncDeletionRecord, SyncOutboxPage, SyncOutboxSegment, SyncStateSnapshot } from "@drifty/domain";
import {
  SYNC_DEVICE_ID_KEY,
  SYNC_PUSH_BATCH_LIMIT,
  SYNC_PUSH_SEQ_KEY,
  runSyncPushCycle,
  type DeviceSyncEngineDeps,
} from "./deviceSyncEngine";

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
  outboxPages,
  deletions = [],
}: {
  snapshot: SyncStateSnapshot;
  outboxPages: SyncOutboxPage[];
  deletions?: SyncDeletionRecord[][];
}) {
  let outboxCall = 0;
  let deletionCall = 0;
  const setSyncState = vi.fn(async () => ({ written: 1 }));
  const markSyncDeletionsPushed = vi.fn(async () => ({ marked: 0 }));
  const applySyncedSegments = vi.fn(async (segments: unknown[]) => ({ inserted: segments.length, updated: 0, skipped: 0 }));
  const applySyncedDeletions = vi.fn(async (items: unknown[]) => ({ applied: items.length, skipped: 0 }));
  const tracker: TrackerStub = {
    getSyncState: async () => snapshot,
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
      acceptedSegments: 2,
      acceptedDeletions: 0,
      serverTime: "2026-07-09T00:00:00+00:00",
    }));

    const status = await runSyncPushCycle({ tracker, pushBatch, sleep: async () => {} }, "startup");

    expect(pushBatch).toHaveBeenCalledTimes(1);
    expect(setSyncState).toHaveBeenCalledWith(
      expect.objectContaining({ [SYNC_PUSH_SEQ_KEY]: "2", [SYNC_DEVICE_ID_KEY]: "device-1" }),
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
