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

  it("publishes the versioned frame region to the native controller", async () => {
    tauri.invoke.mockResolvedValueOnce(undefined);
    const { updateNativePetHitRegion } = await import("./petModeBridge");
    await updateNativePetHitRegion({
      version: 1,
      generation: "test-generation",
      regionId: "tail:12",
      revision: 7,
      mirrored: true,
      spans: [20, 10, 40],
    });
    expect(tauri.invoke).toHaveBeenCalledWith("pet_mode_update_hit_region", {
      update: {
        version: 1,
        generation: "test-generation",
        regionId: "tail:12",
        revision: 7,
        mirrored: true,
        spans: [20, 10, 40],
      },
    });
  });

  it("keeps single-target hunts fixed and gives chase hunts bounded soft turns", async () => {
    tauri.invoke.mockResolvedValue(null);
    const { stalkNativePetCursor } = await import("./petModeBridge");

    await stalkNativePetCursor({ enabled: true, mode: "single", chaseDurationMs: 8_000, softTurns: true });
    expect(tauri.invoke).toHaveBeenLastCalledWith("pet_mode_stalk_cursor", {
      request: {
        durationMs: 3_200,
        biteGap: 0,
        speed: 220,
        retargetCursor: false,
        turnHysteresis: 0,
        turnCooldownMs: 0,
      },
    });

    await stalkNativePetCursor({ enabled: true, mode: "chase", chaseDurationMs: 8_000, softTurns: true });
    expect(tauri.invoke).toHaveBeenLastCalledWith("pet_mode_stalk_cursor", {
      request: {
        durationMs: 8_000,
        biteGap: 0,
        speed: 220,
        retargetCursor: true,
        turnHysteresis: 48,
        turnCooldownMs: 500,
      },
    });
  });

  it("carries calm, alert, and evasive cursors on three bounded durations", async () => {
    tauri.invoke.mockResolvedValue(null);
    const { returnWithNativePetCursor } = await import("./petModeBridge");
    const base = { targetX: 640, targetY: 320, approachFacing: "right" as const };

    await returnWithNativePetCursor({ ...base, cursorMovementDistance: 7 });
    expect(tauri.invoke).toHaveBeenLastCalledWith("pet_mode_carry_cursor", {
      request: {
        targetX: 640,
        targetY: 320,
        approachFacing: "right",
        distance: 128,
        durationMs: 8_000,
        captureRadius: 18,
      },
    });

    await returnWithNativePetCursor({ ...base, cursorMovementDistance: 12 });
    expect(tauri.invoke).toHaveBeenLastCalledWith("pet_mode_carry_cursor", {
      request: {
        targetX: 640,
        targetY: 320,
        approachFacing: "right",
        distance: 128,
        durationMs: 5_000,
        captureRadius: 18,
      },
    });

    await returnWithNativePetCursor({ ...base, cursorMovementDistance: 18 });
    expect(tauri.invoke).toHaveBeenLastCalledWith("pet_mode_carry_cursor", {
      request: {
        targetX: 640,
        targetY: 320,
        approachFacing: "right",
        distance: 128,
        durationMs: 2_500,
        captureRadius: 18,
      },
    });
  });
});
