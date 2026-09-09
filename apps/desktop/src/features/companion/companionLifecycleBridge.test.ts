// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { listenToNativeDriftAlarmAction } from "./driftAlarmBridge";
import { hideNativeWatcherPeek, listenToNativeCompanionPillClear, presentPreparedNativeCompanionMoment, setNativeCompanionPillState } from "./watcherBridge";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
afterEach(() => vi.clearAllMocks());

describe("Companion lifecycle bridge", () => {
  it("carries identity and deadline through preparation and uses the returned token", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    try {
      native.invoke.mockResolvedValueOnce({ prepared: true, menuAnchorX: 100, presentationId: 17 });
      const result = await setNativeCompanionPillState("drift", "driftAlarm:a", 12345);
      expect(native.invoke).toHaveBeenCalledWith("watcher_companion_set_state", {
        state: "drift", animated: true, momentKey: "driftAlarm:a", expiresAtMs: 12345,
      });
      native.invoke.mockResolvedValueOnce(false);
      expect(await presentPreparedNativeCompanionMoment(result.presentationId!)).toBe(false);
      expect(native.invoke).toHaveBeenLastCalledWith("watcher_companion_present_prepared", { presentationId: 17 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves the action identity until the main window receives it", async () => {
    const act = vi.fn();
    await listenToNativeDriftAlarmAction(act);
    const handler = native.listen.mock.calls[0]?.[1];
    handler({ payload: { action: { type: "manual_correction" }, momentKey: "driftAlarm:old" } });
    expect(act).toHaveBeenCalledWith({ type: "manual_correction" }, "driftAlarm:old");
  });

  it("retains the intended target in both hide requests and clear events", async () => {
    await hideNativeWatcherPeek("watcherPeek:1");
    expect(native.invoke).toHaveBeenCalledWith("watcher_peek_hide", { momentKey: "watcherPeek:1" });
    const clear = vi.fn();
    await listenToNativeCompanionPillClear(clear);
    const handler = native.listen.mock.calls[0]?.[1];
    handler({ payload: { momentKey: "driftAlarm:old" } });
    expect(clear).toHaveBeenLastCalledWith("driftAlarm:old");
    handler({ payload: { momentKey: null } });
    expect(clear).toHaveBeenLastCalledWith(null);
  });
});
