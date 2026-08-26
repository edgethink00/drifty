// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_DEVICE_SYNC_STATUS } from "./deviceSyncTypes";
import { useDeviceSyncController } from "./useDeviceSyncController";

const engineMocks = vi.hoisted(() => ({
  runSyncCycle: vi.fn(),
}));

vi.mock("./deviceSyncEngine", () => ({
  runSyncCycle: engineMocks.runSyncCycle,
  SYNC_DEVICE_ID_KEY: "sync.deviceId",
  SYNC_GENERATION_KEY: "sync.generation",
}));
vi.mock("../../lib/api/previewData", () => ({ shouldUsePreviewData: () => false }));
vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: {
    getSyncState: vi.fn(async () => ({ state: { "sync.generation": "1" } })),
    setSyncState: vi.fn(async () => {}),
    purgeRemoteSegments: vi.fn(async () => {}),
  },
}));
vi.mock("./deviceSyncApi", () => ({
  DeviceSyncHttpError: class DeviceSyncHttpError extends Error {
    readonly code: string | null = null;
    readonly syncGeneration: number | null = null;
  },
  fetchSyncDevices: vi.fn(async () => ({ deviceId: "device-1", devices: [], syncStatus: "active", syncGeneration: 1 })),
  fetchSyncedDeletionsPage: vi.fn(),
  fetchSyncedSegmentsPage: vi.fn(),
  pushSyncBatch: vi.fn(),
}));
vi.mock("./deviceSyncAccountScope", () => ({
  prepareDeviceSyncAccountScope: vi.fn(async () => {}),
  suspendDeviceSyncAccountScope: vi.fn(),
}));
vi.mock("./deviceSyncPurgeState", () => ({
  buildSyncStateAfterCloudPurge: vi.fn(() => ({})),
}));
vi.mock("./deviceSyncState", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original };
});

describe("useDeviceSyncController", () => {
  beforeEach(() => {
    window.localStorage.clear();
    engineMocks.runSyncCycle.mockReset();
  });

  it("quiesces new work and waits for an in-flight cycle before resolving", async () => {
    let finishCycle: (() => void) | null = null;
    engineMocks.runSyncCycle.mockImplementationOnce(() => new Promise((resolve) => {
      finishCycle = () => resolve({ status: IDLE_DEVICE_SYNC_STATUS, pulledCount: 0 });
    }));

    const { result } = renderHook(() => useDeviceSyncController({
      syncActive: true,
      userScopeKey: "user-1",
      syncAccountId: "account-1",
    }));
    await waitFor(() => expect(engineMocks.runSyncCycle).toHaveBeenCalledTimes(1));

    let quiesced = false;
    const quiescePromise = result.current.quiesce().then(() => { quiesced = true; });
    await act(async () => {
      await result.current.syncNow();
    });
    expect(engineMocks.runSyncCycle).toHaveBeenCalledTimes(1);
    expect(quiesced).toBe(false);

    await act(async () => {
      finishCycle?.();
      await quiescePromise;
    });
    expect(quiesced).toBe(true);
  });
});
