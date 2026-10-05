import { afterEach, describe, expect, it, vi } from "vitest";

import { BUILD_INFO } from "../../buildInfo";
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
      appVersion: BUILD_INFO.version,
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
      appVersion: BUILD_INFO.version,
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
      appVersion: BUILD_INFO.version,
    });
  });

  it("bounds long native Windows names for previously deployed Cloud readers", async () => {
    const label = "LG Electronics 16Z90Q-G.AA5BK (12th Gen Intel(R) Core(TM) i5-1240P) — Engineering Workstation";
    tauriCoreMock.isTauri.mockReturnValue(true);
    tauriCoreMock.invoke.mockResolvedValue({
      installId: "33333333-3333-4333-8333-333333333333",
      label: `  ${label}  `,
      platform: "windows",
    });

    const { readCloudDevicePayload } = await import("./cloudDeviceIdentity");
    const payload = await readCloudDevicePayload();

    expect(payload).toEqual({
      installId: "33333333-3333-4333-8333-333333333333",
      label: label.slice(0, 80),
      platform: "windows",
      appVersion: BUILD_INFO.version,
    });
    expect(payload?.label.length).toBeLessThanOrEqual(80);
  });

  it("does not split a Unicode character at the outgoing name limit", async () => {
    const prefix = "기".repeat(79);
    tauriCoreMock.isTauri.mockReturnValue(true);
    tauriCoreMock.invoke.mockResolvedValue({
      installId: "33333333-3333-4333-8333-333333333333",
      label: `${prefix}💻 workstation`,
      platform: "windows",
    });

    const { readCloudDevicePayload } = await import("./cloudDeviceIdentity");

    expect((await readCloudDevicePayload())?.label).toBe(prefix);
  });

  it("skips native Cloud device lookup outside Tauri", async () => {
    tauriCoreMock.isTauri.mockReturnValue(false);

    const { readCloudDevicePayload } = await import("./cloudDeviceIdentity");
    const payload = await readCloudDevicePayload();

    expect(tauriCoreMock.invoke).not.toHaveBeenCalled();
    expect(payload).toBeNull();
  });

  it("reports the running build version, not the frozen cloud contract floor", async () => {
    tauriCoreMock.isTauri.mockReturnValue(true);
    tauriCoreMock.invoke.mockResolvedValue({
      installId: "44444444-4444-4444-8444-444444444444",
      label: "MacBook Air (Apple M2)",
      platform: "macos",
    });

    const { readCloudDevicePayload } = await import("./cloudDeviceIdentity");
    const payload = await readCloudDevicePayload();

    // Cloud device rows drive the Account settings version label and the only
    // server-side view of which build each install is running. Pinning them to
    // CLOUD_API_CLIENT_VERSION made every device report the same frozen value,
    // which hid real rollout state.
    expect(payload?.appVersion).toBe(BUILD_INFO.version);
    expect(payload?.appVersion).not.toBe(CLOUD_API_CLIENT_VERSION);
  });
});
