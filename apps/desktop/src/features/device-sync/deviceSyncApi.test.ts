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

import { purgeCloudSyncData } from "./deviceSyncApi";

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
});
