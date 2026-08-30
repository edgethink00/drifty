// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
// Assert against the shipped tiers rather than copies of their values: this
// test exists to prove the bridge forwards the resolved duration, not to pin
// the timings, which are a product decision that lives in one place.
import {
  DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
  resolvePetModeDriftCursorReturnDuration,
} from "./petModeDriftHunt";

const tauri = vi.hoisted(() => ({ emit: vi.fn(), invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
const tauriListen = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: tauri.emit, listen: tauriListen.listen }));
vi.mock("../companion/watcherBridge", () => ({ isTauriRuntime: () => true }));

async function loadSetEnabled() {
  const bridge = await import("./petModeBridge");
  return bridge.setNativePetModeEnabled;
}

describe("pet mode enabled bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    tauri.emit.mockReset();
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
      forceReveal: false,
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
      forceReveal: false,
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
      forceReveal: false,
    });
  });

  it("forwards an explicit force-reveal request even when enabled stays true", async () => {
    tauri.invoke.mockResolvedValueOnce(undefined);
    const setEnabled = await loadSetEnabled();

    await expect(setEnabled(true, null, false, 144, 99, true)).resolves.toBe(true);

    expect(tauri.invoke).toHaveBeenCalledWith("pet_mode_set_enabled", {
      enabled: true,
      snapshot: null,
      reducedMotion: false,
      width: 144,
      height: 99,
      forceReveal: true,
    });
  });

  it("publishes a renderer-only facing preview without changing native movement", async () => {
    tauri.emit.mockResolvedValueOnce(undefined);
    const { previewNativePetModeFacing } = await import("./petModeBridge");

    await expect(previewNativePetModeFacing("left")).resolves.toBe(true);

    expect(tauri.emit).toHaveBeenCalledWith("pet-mode-event", {
      kind: "preview_facing",
      facing: "left",
    });
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("carries one native generation through the complete outing lifecycle", async () => {
    tauri.invoke
      .mockResolvedValueOnce({ side: "right", generation: 19 })
      .mockResolvedValue(undefined);
    const {
      exitNativePetScreen,
      returnNativePetFromOuting,
      setNativePetPresence,
    } = await import("./petModeBridge");

    const ticket = await exitNativePetScreen();
    await setNativePetPresence(false, ticket.generation);
    await returnNativePetFromOuting(ticket);

    expect(ticket).toEqual({ side: "right", generation: 19 });
    expect(tauri.invoke).toHaveBeenNthCalledWith(1, "pet_mode_exit_screen");
    expect(tauri.invoke).toHaveBeenNthCalledWith(2, "pet_mode_set_presence", {
      visible: false,
      outingGeneration: 19,
    });
    expect(tauri.invoke).toHaveBeenNthCalledWith(3, "pet_mode_return_from_outing", {
      side: "right",
      outingGeneration: 19,
    });
  });

  it("forwards the explicit floor-drop decision to the native resolver", async () => {
    tauri.invoke.mockResolvedValueOnce({
      kind: "catch",
      distance: 400,
      durationMs: 300,
      targetY: 700,
      ledge: "floor",
    });
    const { resolveNativePetDrop } = await import("./petModeBridge");

    await resolveNativePetDrop(true);

    expect(tauri.invoke).toHaveBeenCalledWith("pet_mode_resolve_drop", { forceFloor: true });
  });

  it("keeps the existing native drop resolver as the default", async () => {
    tauri.invoke.mockResolvedValueOnce({
      kind: "hop",
      distance: 4,
      durationMs: 16,
      targetY: 204,
      ledge: "hop",
    });
    const { resolveNativePetDrop } = await import("./petModeBridge");

    await resolveNativePetDrop();

    expect(tauri.invoke).toHaveBeenCalledWith("pet_mode_resolve_drop", { forceFloor: false });
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

    await stalkNativePetCursor({ ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS, enabled: true, mode: "single" });
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

    await stalkNativePetCursor({
      ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
      enabled: true,
      mode: "chase",
      stalkSpeed: 280,
    });
    expect(tauri.invoke).toHaveBeenLastCalledWith("pet_mode_stalk_cursor", {
      request: {
        durationMs: 8_000,
        biteGap: 0,
        speed: 280,
        retargetCursor: true,
        turnHysteresis: 48,
        turnCooldownMs: 500,
      },
    });
  });

  it("carries calm, alert, and evasive cursors on three bounded durations", async () => {
    tauri.invoke.mockResolvedValue(null);
    const { returnWithNativePetCursor } = await import("./petModeBridge");
    const settings = {
      ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
      carryDistance: 96,
      carryStillDurationMs: 5_000,
      captureRadius: 24,
      cursorLagMs: 160,
      cursorSlack: 10,
      cursorYankDistance: 44,
      cursorGripMs: 760,
    };
    const base = { targetX: 640, targetY: 320, approachFacing: "right" as const, settings };

    await returnWithNativePetCursor({ ...base, cursorMovementDistance: 7 });
    expect(tauri.invoke).toHaveBeenLastCalledWith("pet_mode_carry_cursor", {
      request: {
        targetX: 640,
        targetY: 320,
        approachFacing: "right",
        distance: 96,
        durationMs: resolvePetModeDriftCursorReturnDuration(7, settings),
        captureRadius: 24,
        cursorLagMs: 160,
        gripTolerance: 10,
        yankDistance: 44,
        maxGripMs: 760,
      },
    });

    await returnWithNativePetCursor({ ...base, cursorMovementDistance: 12 });
    expect(tauri.invoke).toHaveBeenLastCalledWith("pet_mode_carry_cursor", {
      request: {
        targetX: 640,
        targetY: 320,
        approachFacing: "right",
        distance: 96,
        durationMs: resolvePetModeDriftCursorReturnDuration(12, settings),
        captureRadius: 24,
        cursorLagMs: 160,
        gripTolerance: 10,
        yankDistance: 44,
        maxGripMs: 760,
      },
    });

    await returnWithNativePetCursor({ ...base, cursorMovementDistance: 18 });
    expect(tauri.invoke).toHaveBeenLastCalledWith("pet_mode_carry_cursor", {
      request: {
        targetX: 640,
        targetY: 320,
        approachFacing: "right",
        distance: 96,
        durationMs: resolvePetModeDriftCursorReturnDuration(18, settings),
        captureRadius: 24,
        cursorLagMs: 160,
        gripTolerance: 10,
        yankDistance: 44,
        maxGripMs: 760,
      },
    });
  });
});

describe("pet mode intervention outcome classification", () => {
  type ContactHandler = (event: { payload: { id: string; contacted?: boolean; reason?: string } }) => void;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    tauri.emit.mockReset();
    tauri.invoke.mockReset();
    tauriListen.listen.mockReset();
  });

  async function startIntervention() {
    let handler: ContactHandler | null = null;
    const unlisten = vi.fn();
    tauriListen.listen.mockImplementation(async (_event: string, nextHandler: ContactHandler) => {
      handler = nextHandler;
      return unlisten;
    });
    tauri.invoke.mockResolvedValue(undefined);
    const bridge = await import("./petModeBridge");
    const result = bridge.playNativePetModeIntervention({
      id: "alert:1",
      appName: "Aside",
      browserName: "Aside",
      preview: false,
    });
    // Let the listener registration and the intervene invoke settle.
    await vi.advanceTimersByTimeAsync(0);
    return { result, sendContact: (payload: { id: string; contacted?: boolean; reason?: string }) => handler?.({ payload }) };
  }

  it("classifies a paw contact as contacted", async () => {
    const { result, sendContact } = await startIntervention();
    sendContact({ id: "alert:1", contacted: true });
    await expect(result).resolves.toMatchObject({ outcome: "contacted" });
  });

  it("classifies an explicit user interception as user_intercepted", async () => {
    const { result, sendContact } = await startIntervention();
    sendContact({ id: "alert:1", contacted: false, reason: "user_intercepted" });
    await expect(result).resolves.toMatchObject({ outcome: "user_intercepted" });
  });

  it("keeps legacy reason-less failures meaning user interception", async () => {
    // Older pet renderers report contacted=false with no reason only from the
    // interrupted-action paths, so the classification must stay conservative.
    const { result, sendContact } = await startIntervention();
    sendContact({ id: "alert:1", contacted: false });
    await expect(result).resolves.toMatchObject({ outcome: "user_intercepted" });
  });

  it("treats a Rust-serialized null reason as user interception too", async () => {
    // pet_mode_report_contact serializes an omitted Option<String> as null,
    // which must not demote a real catch into a rejected/technical outcome.
    const { result, sendContact } = await startIntervention();
    sendContact({ id: "alert:1", contacted: false, reason: null as unknown as string });
    await expect(result).resolves.toMatchObject({ outcome: "user_intercepted" });
  });

  it("classifies a renderer guard rejection as rejected, not a catch", async () => {
    const { result, sendContact } = await startIntervention();
    sendContact({ id: "alert:1", contacted: false, reason: "renderer_focus_resting" });
    await expect(result).resolves.toMatchObject({ outcome: "rejected", reason: "renderer_focus_resting" });
  });

  it("keeps an activity-context cancellation distinct from a user catch", async () => {
    const { result, sendContact } = await startIntervention();
    sendContact({ id: "alert:1", contacted: false, reason: "activity_context_changed" });
    await expect(result).resolves.toMatchObject({
      outcome: "cancelled",
      reason: "activity_context_changed",
    });
  });

  it("treats malformed contact payloads as technical rejections", async () => {
    const { result, sendContact } = await startIntervention();
    sendContact({ id: "alert:1" });
    await expect(result).resolves.toMatchObject({ outcome: "rejected" });
  });

  it("does not turn a malformed reason into a user catch", async () => {
    const { result, sendContact } = await startIntervention();
    sendContact({ id: "alert:1", contacted: false, reason: 42 as unknown as string });
    await expect(result).resolves.toMatchObject({ outcome: "rejected" });
  });

  it("classifies eight seconds of silence as timed_out, never as a catch", async () => {
    // This is the exact failure observed on 2026-08-29: no contact report
    // arrived and the old boolean collapse turned the timeout into
    // pet_intercepted, cancelling the close the user had enabled.
    const { result } = await startIntervention();
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(result).resolves.toMatchObject({ outcome: "timed_out", reason: "contact_timeout" });
  });

  it("ignores contact reports for other intervention ids", async () => {
    const { result, sendContact } = await startIntervention();
    sendContact({ id: "alert:other", contacted: false, reason: "user_intercepted" });
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(result).resolves.toMatchObject({ outcome: "timed_out" });
  });

  it("classifies a failed intervene invoke as failed", async () => {
    let handler: ContactHandler | null = null;
    tauriListen.listen.mockImplementation(async (_event: string, nextHandler: ContactHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    tauri.invoke.mockRejectedValue(new Error("Pet Mode is disabled"));
    const bridge = await import("./petModeBridge");
    const result = bridge.playNativePetModeIntervention({
      id: "alert:2",
      appName: "Aside",
      browserName: "Aside",
      preview: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).not.toBeNull();
    await expect(result).resolves.toMatchObject({ outcome: "failed", reason: "Pet Mode is disabled" });
  });
});
