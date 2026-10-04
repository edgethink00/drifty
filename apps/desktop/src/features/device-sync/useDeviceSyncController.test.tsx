// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSyncDevices } from "./deviceSyncApi";
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
  fetchSyncDevices: vi.fn(async () => ({ deviceId: "device-1", devices: [], syncStatus: "active", syncGeneration: 1, serverTime: "2026-10-05T00:00:00Z" })),
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
    vi.mocked(fetchSyncDevices).mockReset().mockResolvedValue({ deviceId: "device-1", devices: [], syncStatus: "active", syncGeneration: 1, serverTime: "2026-10-05T00:00:00Z" });
  });

  it("omits this computer before a cycle finishes, retains other labels while paused, and hides them on account change", async () => {
    vi.mocked(fetchSyncDevices).mockResolvedValue({ deviceId: "device-1", devices: [
      { id: "device-1", label: "This Mac", isCurrent: false, isActive: true, revokedAt: null },
      { id: "pc", label: "Windows PC", isCurrent: false, isActive: true, revokedAt: null },
    ], syncStatus: "active", syncGeneration: 1, serverTime: "2026-10-05T00:00:00Z" });
    engineMocks.runSyncCycle.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook((props: { account: string | null; active: boolean }) => useDeviceSyncController({
      syncActive: props.active, syncAccountId: props.account, userScopeKey: props.account ?? "guest",
    }), { initialProps: { account: "account-a" as string | null, active: true } });
    await waitFor(() => expect([...result.current.deviceLabelById]).toEqual([["pc", "Windows PC"]]));
    expect(result.current.status.deviceId).toBeNull();
    rerender({ account: "account-a", active: false });
    expect([...result.current.deviceLabelById]).toEqual([["pc", "Windows PC"]]);
    rerender({ account: "account-b", active: false });
    expect(result.current.deviceLabelById.size).toBe(0);
    rerender({ account: null, active: false });
    expect(result.current.deviceLabelById.size).toBe(0);
  });

  it("ignores a late device-list response after switching accounts", async () => {
    let finishFetch: ((response: Awaited<ReturnType<typeof fetchSyncDevices>>) => void) | undefined;
    vi.mocked(fetchSyncDevices).mockImplementation(() => new Promise((resolve) => { finishFetch = resolve; }));
    const { result, rerender } = renderHook((props: { account: string; active: boolean }) => useDeviceSyncController({
      syncActive: props.active, syncAccountId: props.account, userScopeKey: props.account,
    }), { initialProps: { account: "account-a", active: true } });
    await waitFor(() => expect(fetchSyncDevices).toHaveBeenCalled());
    rerender({ account: "account-b", active: false });
    await act(async () => { finishFetch?.({ deviceId: "device-1", devices: [{ id: "pc", label: "Account A PC", isCurrent: false, isActive: true, revokedAt: null }], syncStatus: "active", syncGeneration: 1, serverTime: "2026-10-05T00:00:00Z" }); });
    expect(result.current.deviceLabelById.size).toBe(0);
    expect(engineMocks.runSyncCycle).not.toHaveBeenCalled();
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
