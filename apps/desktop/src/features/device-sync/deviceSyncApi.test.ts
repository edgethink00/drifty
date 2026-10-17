import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  readCloudDevicePayload: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../cloud-devices/cloudDeviceIdentity", () => ({
  readCloudDevicePayload: mocks.readCloudDevicePayload,
}));
vi.mock("../../lib/supabase/client", () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

import { fetchPhoneTimeBlocks, fetchSyncedDeletionsPage, fetchSyncedSegmentsPage, purgeCloudSyncData } from "./deviceSyncApi";

describe("device sync API purge", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.readCloudDevicePayload.mockReset();
    mocks.getSession.mockReset();
    mocks.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "access-token",
          user: { id: "user-1" },
        },
      },
    });
    mocks.invoke.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        deviceId: null,
        syncGeneration: 3,
        syncStatus: "paused",
        purgedSegments: 2,
        serverTime: "2026-09-13T00:00:00.000Z",
      }),
      latencyMs: 10,
    });
  });

  it("does not require or send a cloud-device identity", async () => {
    await expect(purgeCloudSyncData("user-1")).resolves.toMatchObject({
      deviceId: null,
      syncGeneration: 3,
      syncStatus: "paused",
    });

    expect(mocks.readCloudDevicePayload).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("cloud_sync_http_post", {
      request: expect.objectContaining({
        bearerToken: "access-token",
        bodyJson: {
          action: "purge",
          accountId: "user-1",
          trialActivation: "explicit-v1",
        },
      }),
    });
  });

  it.each(["segments", "deletions"])("downloads %s through native authenticated HTTP", async (kind) => {
    mocks.readCloudDevicePayload.mockResolvedValue({ installId: "install-1" });
    mocks.invoke.mockResolvedValue({ status: 200, body: JSON.stringify({ rows: [], nextCursor: null, hasMore: false, syncGeneration: 3 }) });
    const pull = kind === "segments" ? fetchSyncedSegmentsPage : fetchSyncedDeletionsPage;
    await expect(pull("cursor-1", "device-1", "user-1", 3, 20)).resolves.toMatchObject({ nextCursor: "cursor-1", hasMore: false });
    expect(mocks.invoke).toHaveBeenCalledWith("cloud_sync_http_post", {
      request: expect.objectContaining({
        bodyJson: { action: "pull", accountId: "user-1", trialActivation: "explicit-v1",
          cloudDevice: { installId: "install-1" }, kind, cursor: "cursor-1", excludeDeviceId: "device-1", syncGeneration: 3, limit: 20 },
      }),
    });
  });

  it("rejects account changes before sending a download", async () => {
    await expect(fetchSyncedSegmentsPage(null, "device-1", "user-2", 3)).rejects.toMatchObject({ code: "sync_account_changed" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("propagates a denied download without a direct-table fallback", async () => {
    mocks.readCloudDevicePayload.mockResolvedValue({ installId: "install-1" });
    mocks.invoke.mockResolvedValue({ status: 402, body: JSON.stringify({ error: "Access expired" }) });
    await expect(fetchSyncedSegmentsPage(null, "device-1", "user-1", 3)).rejects.toMatchObject({ status: 402 });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("reads the iPhone's phone time without registering this Mac", async () => {
    mocks.invoke.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        rows: [
          { started_at: "2026-10-17T01:00:00Z", ended_at: "2026-10-17T01:25:00Z", minutes: 25, group_label: "SNS" },
          { started_at: "2026-10-17T02:00:00Z", ended_at: "2026-10-17T02:00:00Z", minutes: 0, group_label: "SNS" },
        ],
        serverTime: "2026-10-17T03:00:00Z",
      }),
    });
    await expect(fetchPhoneTimeBlocks("user-1", "2026-10-16T15:00:00.000Z", "2026-10-17T15:00:00.000Z")).resolves.toEqual([
      { startedAt: "2026-10-17T01:00:00Z", endedAt: "2026-10-17T01:25:00Z", minutes: 25, label: "SNS" },
    ]);
    expect(mocks.readCloudDevicePayload).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("cloud_sync_http_post", {
      request: expect.objectContaining({
        bodyJson: {
          action: "phone-range",
          accountId: "user-1",
          trialActivation: "explicit-v1",
          from: "2026-10-16T15:00:00.000Z",
          to: "2026-10-17T15:00:00.000Z",
        },
      }),
    });
  });
});
