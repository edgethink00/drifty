// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findDeviceSyncCycleRecord,
  readDeviceSyncCycleRecords,
  upsertDeviceSyncCycleRecord,
  writeDeviceSyncCycleRecords,
} from "./deviceSyncState";
import { ACCOUNT_DELETION_NEUTRAL_SYNC_STATE, resetAccountSyncIdentity } from "./accountDeletionSyncReset";

describe("resetAccountSyncIdentity", () => {
  beforeEach(() => window.localStorage.clear());

  it("drains the active cycle before clearing the old account's final pacing record and durable identity", async () => {
    writeDeviceSyncCycleRecords([
      { userScopeKey: "user-1", lastAttemptAt: "2026-08-26T00:00:00.000Z", lastSuccessAt: null, lastErrorAt: null },
      { userScopeKey: "other-user", lastAttemptAt: "2026-08-26T00:00:00.000Z", lastSuccessAt: null, lastErrorAt: null },
    ]);
    let finishCycle!: () => void;
    const cycleSettled = new Promise<void>((resolve) => { finishCycle = resolve; });
    const setSyncState = vi.fn(async (state: typeof ACCOUNT_DELETION_NEUTRAL_SYNC_STATE) => {
      expect(findDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), "user-1")).toBeNull();
      expect(state).toEqual(ACCOUNT_DELETION_NEUTRAL_SYNC_STATE);
    });

    const resetPromise = resetAccountSyncIdentity({
      userScopeKey: "user-1",
      quiesce: () => cycleSettled,
      setSyncState,
    });

    // Simulate the in-flight controller's final write. A pre-drain clear would
    // be undone here and leak the deleted account's pacing record.
    writeDeviceSyncCycleRecords(upsertDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), {
      userScopeKey: "user-1",
      lastAttemptAt: "2026-08-26T00:01:00.000Z",
      lastSuccessAt: "2026-08-26T00:01:01.000Z",
      lastErrorAt: null,
    }));
    expect(findDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), "user-1")).not.toBeNull();
    expect(setSyncState).not.toHaveBeenCalled();

    finishCycle();
    await resetPromise;

    expect(findDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), "user-1")).toBeNull();
    expect(findDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), "other-user")).not.toBeNull();
    expect(setSyncState).toHaveBeenCalledTimes(1);
  });
});
