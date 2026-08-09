// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(), listen: vi.fn() }));
vi.mock("../companion/watcherBridge", () => ({ isTauriRuntime: () => true }));

async function loadSetEnabled() {
  const bridge = await import("./petModeBridge");
  return bridge.setNativePetModeEnabled;
}

describe("pet mode enabled bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    tauri.invoke.mockReset();
  });

  it("preserves rapid off/on invocation order", async () => {
    let releaseFirst!: () => void;
    const firstInvoke = new Promise<void>((resolve) => { releaseFirst = resolve; });
    tauri.invoke
      .mockImplementationOnce(() => firstInvoke)
      .mockResolvedValueOnce(undefined);
    const setEnabled = await loadSetEnabled();

    const disable = setEnabled(false, null, false, 144, 99);
    const enable = setEnabled(true, null, false, 144, 99);
    await Promise.resolve();

    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenNthCalledWith(1, "pet_mode_set_enabled", {
      enabled: false,
      snapshot: null,
      reducedMotion: false,
      width: 144,
      height: 99,
    });

    releaseFirst();
    await disable;
    await enable;
    expect(tauri.invoke).toHaveBeenCalledTimes(2);
    expect(tauri.invoke).toHaveBeenNthCalledWith(2, "pet_mode_set_enabled", {
      enabled: true,
      snapshot: null,
      reducedMotion: false,
      width: 144,
      height: 99,
    });
  });

  it("allows the next transition after a rejected native invocation", async () => {
    tauri.invoke
      .mockRejectedValueOnce(new Error("native unavailable"))
      .mockResolvedValueOnce(undefined);
    const setEnabled = await loadSetEnabled();

    await expect(setEnabled(false, null, false, 144, 99)).rejects.toThrow("native unavailable");
    await expect(setEnabled(true, null, true, 180, 124)).resolves.toBe(true);

    expect(tauri.invoke).toHaveBeenNthCalledWith(2, "pet_mode_set_enabled", {
      enabled: true,
      snapshot: null,
      reducedMotion: true,
      width: 180,
      height: 124,
    });
  });
});
