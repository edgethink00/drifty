import { describe, expect, it, vi } from "vitest";
import { prepareDeviceSyncAccountScope, suspendDeviceSyncAccountScope } from "./deviceSyncAccountScope";

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
    });
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

function makeTracker(state: Record<string, string>) {
  return {
    getSyncState: vi.fn().mockResolvedValue({ state, counterSeq: 42 }),
    purgeRemoteSegments: vi.fn().mockResolvedValue({ deleted: 3 }),
    setSyncState: vi.fn().mockResolvedValue({ updated: 1 }),
  };
}
