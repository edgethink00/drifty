import { afterEach, describe, expect, it, vi } from "vitest";

import { CLOUD_API_CLIENT_VERSION } from "../../lib/cloudContract";

type MockInvoke = (command: string) => Promise<unknown>;

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn<MockInvoke>(),
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
    tauriCoreMock.invoke.mockResolvedValue({
      installId: "11111111-1111-4111-8111-111111111111",
      label: "MacBook Pro (Apple M1 Pro)",
      platform: "macos",
    });

    const { readCloudDevicePayload } = await import("./cloudDeviceIdentity");
    const payload = await readCloudDevicePayload();

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("cloud_device_identity");
    expect(payload).toEqual({
      installId: "11111111-1111-4111-8111-111111111111",
      label: "MacBook Pro (Apple M1 Pro)",
      platform: "macos",
      appVersion: CLOUD_API_CLIENT_VERSION,
    });
  });

  it("preserves a native Windows identity in the Cloud payload", async () => {
    tauriCoreMock.isTauri.mockReturnValue(true);
    tauriCoreMock.invoke.mockResolvedValue({
      installId: "33333333-3333-4333-8333-333333333333",
      label: "LG 16Z90Q (Intel Core i5)",
      platform: "windows",
    });

    const { readCloudDevicePayload } = await import("./cloudDeviceIdentity");

    await expect(readCloudDevicePayload()).resolves.toEqual({
      installId: "33333333-3333-4333-8333-333333333333",
      label: "LG 16Z90Q (Intel Core i5)",
      platform: "windows",
      appVersion: CLOUD_API_CLIENT_VERSION,
    });
  });

  it("falls back to the legacy install id command when native identity lookup is unavailable", async () => {
    tauriCoreMock.isTauri.mockReturnValue(true);
    tauriCoreMock.invoke.mockImplementation((command) => {
      if (command === "cloud_device_identity") return Promise.reject(new Error("unknown command"));
      if (command === "cloud_device_install_id") return Promise.resolve("22222222-2222-4222-8222-222222222222");
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });

    const { readCloudDevicePayload } = await import("./cloudDeviceIdentity");
    const payload = await readCloudDevicePayload();

    expect(tauriCoreMock.invoke).toHaveBeenNthCalledWith(1, "cloud_device_identity");
    expect(tauriCoreMock.invoke).toHaveBeenNthCalledWith(2, "cloud_device_install_id");
    expect(payload).toEqual({
      installId: "22222222-2222-4222-8222-222222222222",
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
