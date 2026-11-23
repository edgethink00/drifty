import { describe, expect, it, vi } from "vitest";
import {
  hasCarriedSyncHistory,
  includeCarriedSyncHistory,
  prepareDeviceSyncAccountScope,
  suspendDeviceSyncAccountScope,
} from "./deviceSyncAccountScope";

describe("prepareDeviceSyncAccountScope", () => {
  it("keeps existing cursors for the same account", async () => {
    const tracker = makeTracker({ sync_account_id: "user-1", sync_push_seq: "42" });

    await expect(prepareDeviceSyncAccountScope(tracker, "user-1")).resolves.toBe(false);
    expect(tracker.purgeRemoteSegments).not.toHaveBeenCalled();
    expect(tracker.setSyncState).not.toHaveBeenCalled();
  });

  it("purges remote rows and preserves the device-global push cursor", async () => {
    const tracker = makeTracker({ sync_account_id: "user-1", sync_push_seq: "42", sync_generation: "7" });

    await expect(prepareDeviceSyncAccountScope(tracker, "user-2")).resolves.toBe(true);
    expect(tracker.purgeRemoteSegments).toHaveBeenCalledTimes(1);
    expect(tracker.setSyncState).toHaveBeenCalledWith({
      sync_account_id: "user-2",
      sync_pull_cursor: null,
      sync_deletion_pull_cursor: null,
      sync_device_id: null,
      sync_generation: null,
      sync_last_pushed_at: null,
      sync_last_pulled_at: null,
      sync_definition_ledger: null,
      sync_carried_push_seq: "42",
    });
  });

  it("carries nothing from a device that never uploaded, whose first opt-in sends all history", async () => {
    const tracker = makeTracker({});

    await expect(prepareDeviceSyncAccountScope(tracker, "user-2")).resolves.toBe(true);
    expect(tracker.setSyncState).toHaveBeenCalledWith(expect.objectContaining({
      sync_account_id: "user-2",
      sync_carried_push_seq: null,
    }));
  });

  it("does not commit a stale account after its scope operation is superseded", async () => {
    const tracker = makeTracker({ sync_account_id: "user-1" });
    let current = true;
    tracker.purgeRemoteSegments.mockImplementationOnce(async () => {
      current = false;
      return { purged: 3 };
    });

    await expect(prepareDeviceSyncAccountScope(tracker, "user-2", () => current)).resolves.toBe(false);
    expect(tracker.setSyncState).not.toHaveBeenCalled();
  });

  it("purges remote rows on sign-out while preserving the bound account and push cursor", async () => {
    const tracker = makeTracker({ sync_account_id: "user-1", sync_push_seq: "42", sync_generation: "7" });

    await expect(suspendDeviceSyncAccountScope(tracker)).resolves.toBeUndefined();

    expect(tracker.purgeRemoteSegments).toHaveBeenCalledTimes(1);
    expect(tracker.setSyncState).toHaveBeenCalledWith({
      sync_pull_cursor: null,
      sync_deletion_pull_cursor: null,
      sync_last_pulled_at: null,
    });
  });
});

describe("carried sync history", () => {
  it("is offered only to the account now bound to this device", () => {
    const state = { sync_account_id: "user-2", sync_push_seq: "42", sync_carried_push_seq: "42" };

    expect(hasCarriedSyncHistory(state, "user-2")).toBe(true);
    expect(hasCarriedSyncHistory(state, "user-3")).toBe(false);
    expect(hasCarriedSyncHistory({ ...state, sync_carried_push_seq: "0" }, "user-2")).toBe(false);
    expect(hasCarriedSyncHistory({ sync_account_id: "user-2", sync_carried_push_seq: "42" }, "user-2")).toBe(false);
  });

  it("restarts the push outbox so the account receives this device's earlier activity", async () => {
    const tracker = makeTracker({ sync_account_id: "user-2", sync_push_seq: "57", sync_carried_push_seq: "42" });

    await expect(includeCarriedSyncHistory(tracker, "user-2")).resolves.toBe(true);
    expect(tracker.setSyncState).toHaveBeenCalledWith({
      sync_push_seq: null,
      sync_carried_push_seq: null,
    });
    expect(tracker.purgeRemoteSegments).not.toHaveBeenCalled();
  });

  it("leaves the cursor alone for another account or a superseded choice", async () => {
    const tracker = makeTracker({ sync_account_id: "user-2", sync_push_seq: "57", sync_carried_push_seq: "42" });

    await expect(includeCarriedSyncHistory(tracker, "user-3")).resolves.toBe(false);
    await expect(includeCarriedSyncHistory(tracker, "user-2", () => false)).resolves.toBe(false);
    expect(tracker.setSyncState).not.toHaveBeenCalled();
  });

  it("waits for an account change in progress before deciding", async () => {
    const state: Record<string, string> = { sync_account_id: "user-2", sync_push_seq: "57", sync_carried_push_seq: "42" };
    const tracker = makeTracker(state);
    let finishPurge!: () => void;
    tracker.purgeRemoteSegments.mockImplementationOnce(() => new Promise((resolve) => {
      finishPurge = () => resolve({ purged: 0 });
    }));
    tracker.setSyncState.mockImplementation(async (entries: Record<string, string | null>) => {
      for (const [key, value] of Object.entries(entries)) {
        if (value === null) delete state[key];
        else state[key] = value;
      }
      return { written: Object.keys(entries).length };
    });

    const switching = prepareDeviceSyncAccountScope(tracker, "user-3");
    const including = includeCarriedSyncHistory(tracker, "user-2");
    await vi.waitFor(() => expect(tracker.purgeRemoteSegments).toHaveBeenCalled());
    finishPurge();

    await expect(switching).resolves.toBe(true);
    await expect(including).resolves.toBe(false);
    expect(state).toMatchObject({ sync_account_id: "user-3", sync_push_seq: "57", sync_carried_push_seq: "57" });
  });
});

function makeTracker(state: Record<string, string>) {
  return {
    getSyncState: vi.fn(async () => ({ state: { ...state }, counterSeq: 42, pendingDeletions: 0 })),
    purgeRemoteSegments: vi.fn().mockResolvedValue({ deleted: 3 }),
    setSyncState: vi.fn().mockResolvedValue({ updated: 1 }),
  };
}
