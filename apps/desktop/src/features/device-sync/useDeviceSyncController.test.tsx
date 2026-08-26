// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_DEVICE_SYNC_STATUS } from "./deviceSyncTypes";
import { useDeviceSyncController } from "./useDeviceSyncController";

const engineMocks = vi.hoisted(() => ({
  runSyncCycle: vi.fn(),
}));

vi.mock("./deviceSyncEngine", () => ({ runSyncCycle: engineMocks.runSyncCycle }));
vi.mock("../../lib/api/previewData", () => ({ shouldUsePreviewData: () => false }));
vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: {} }));
vi.mock("./deviceSyncApi", () => ({
  fetchSyncDevices: vi.fn(async () => ({ deviceId: null, devices: [] })),
  fetchSyncedDeletionsPage: vi.fn(),
  fetchSyncedSegmentsPage: vi.fn(),
  pushSyncBatch: vi.fn(),
}));

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
