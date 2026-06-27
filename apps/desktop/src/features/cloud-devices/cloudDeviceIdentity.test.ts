import { afterEach, describe, expect, it, vi } from "vitest";

import { CLOUD_API_CLIENT_VERSION } from "../../lib/cloudContract";

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn<() => Promise<string>>(),
  isTauri: vi.fn<() => boolean>(),
}));

vi.mock("@tauri-apps/api/core", () => tauriCoreMock);

describe("cloudDeviceIdentity", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("reads the Cloud device payload when the Tauri runtime flag is present", async () => {
    tauriCoreMock.isTauri.mockReturnValue(true);
    tauriCoreMock.invoke.mockResolvedValue("11111111-1111-4111-8111-111111111111");

    const { readCloudDevicePayload } = await import("./cloudDeviceIdentity");
    const payload = await readCloudDevicePayload();

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("cloud_device_install_id");
    expect(payload).toEqual({
      installId: "11111111-1111-4111-8111-111111111111",
      label: "Mac",
      platform: "macos",
      appVersion: CLOUD_API_CLIENT_VERSION,
    });
  });

  it("skips native Cloud device lookup outside Tauri", async () => {
    tauriCoreMock.isTauri.mockReturnValue(false);

    const { readCloudDevicePayload } = await import("./cloudDeviceIdentity");
    const payload = await readCloudDevicePayload();

    expect(tauriCoreMock.invoke).not.toHaveBeenCalled();
    expect(payload).toBeNull();
  });
});
