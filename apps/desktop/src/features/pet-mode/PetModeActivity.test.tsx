// @vitest-environment jsdom
// Renderer lifecycle regression: real rendering/hit-region JS, fake time/native boundary,
// a far stationary pointer, and Math.random=0.9. One case injects 200ms cursor
// latency; one flushes React every 16ms instead of 250ms. No real watts,
// native window behavior, or WebKit throttling is represented.
// Counts are scheduling evidence, not WebKit FPS or power measurements.
import { readFileSync } from "node:fs";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, buildAutomaticCloseOverride } from "../companion/automaticCloseOverride";
import { PetModeWindowApp } from "./PetModeWindowApp";
import { PET_MODE_STORAGE_KEY, type PetModeWindowEvent } from "./petModeData";
import { PET_OUTING_PREFERENCE_STORAGE_KEY } from "./petOutingPreference";
import { PET_PRESENCE_MODE_STORAGE_KEY } from "./petPresenceMode";

const walkFrames = (JSON.parse(
  readFileSync("public/pet-mode/walk-frames-v2.json", "utf8"),
) as { readonly frames: readonly string[] }).frames;
const hitArtifact = JSON.parse(readFileSync("public/pet-mode/hit-regions-v1.json", "utf8"));
const ipc = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
vi.mock("../companion/watcherBridge", () => ({ isTauriRuntime: () => true }));

const bridge = vi.hoisted(() => ({
  alignNativePetContact: vi.fn().mockResolvedValue({
    targetX: 640,
    targetY: 48,
    contactX: 640,
    contactY: 48,
    errorX: 0,
    errorY: 0,
    errorDistance: 0,
    attempts: 1,
    diagnostic: "test_target",
  }),
  beginNativePetDrag: vi.fn().mockResolvedValue({
    moved: false,
    startX: 120,
    startY: 80,
    endX: 120,
    endY: 80,
  }),
  cancelNativePetMotion: vi.fn().mockResolvedValue(undefined),
  dragEndHandler: null as ((result: {
    moved: boolean;
    shakeDetected?: boolean;
    strokeDetected?: boolean;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  }) => void) | null,
  dragStartHandler: null as (() => void) | null,
  strokeDetectedHandler: null as (() => void) | null,
  eventHandler: null as ((event: PetModeWindowEvent) => void) | null,
  listenToNativePetDragEnd: vi.fn().mockImplementation(async (handler) => {
    bridge.dragEndHandler = handler;
    return vi.fn();
  }),
  listenToNativePetDragStart: vi.fn().mockImplementation(async (handler) => {
    bridge.dragStartHandler = handler;
    return vi.fn();
  }),
  listenToNativePetStrokeDetected: vi.fn().mockImplementation(async (handler) => {
    bridge.strokeDetectedHandler = handler;
    return vi.fn();
  }),
  listenToNativePetDragProbe: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetModeEvent: vi.fn(),
  listenToNativePetModeLabStateRequest: vi.fn().mockResolvedValue(vi.fn()),
  moveNativePetToTarget: vi.fn().mockResolvedValue({
    facing: "right",
    targetKind: "browser_tab_close",
    motionOutcome: "completed",
    confidence: "high",
    diagnostic: "ax_selected_tab_close",
    targetX: 640,
    targetY: 48,
  }),
  reportNativePetContact: vi.fn().mockResolvedValue(undefined),
  reportNativePetDragError: vi.fn().mockResolvedValue(undefined),
  reportNativePetModeLabState: vi.fn().mockResolvedValue(undefined),
  reportNativePetPointer: vi.fn().mockResolvedValue(undefined),
  returnNativePetHome: vi.fn().mockResolvedValue(undefined),
  finishNativePetFullscreenIntervention: vi.fn().mockResolvedValue(false),
  exitNativePetScreen: vi.fn().mockResolvedValue({ side: "left", generation: 1 }),
  prepareNativePetOutingHunt: vi.fn().mockResolvedValue({ facing: "right" }),
  returnNativePetFromOuting: vi.fn().mockResolvedValue(undefined),
  roamNativePet: vi.fn().mockResolvedValue(undefined),
  sampleNativePetCursor: vi.fn().mockResolvedValue(null),
  isNativePetCursorInside: vi.fn().mockResolvedValue(false),
  isNativePetQuickControlsCursorInside: vi.fn().mockResolvedValue(false),
  quickControlsMenuStateHandler: null as ((open: boolean) => void) | null,
  listenToNativePetQuickControlsAction: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetQuickControlsMenuState: vi.fn().mockImplementation(async (handler) => {
    bridge.quickControlsMenuStateHandler = handler;
    return vi.fn();
  }),
  setNativePetQuickControlsVisible: vi.fn().mockResolvedValue(undefined),
  triggerNativePetQuickControlsAction: vi.fn().mockResolvedValue(undefined),
  rememberNativePetPosition: vi.fn().mockResolvedValue({
    x: 120,
    y: 80,
    moved: false,
    reason: "no_control_overlap",
  }),
  reconcileNativePetPosition: vi.fn().mockResolvedValue({
    x: 120,
    y: 80,
    moved: false,
    reason: "no_control_overlap",
  }),
  probeNativePetAxSeat: vi.fn().mockResolvedValue({
    x: 120,
    y: 80,
    moved: false,
    reason: "no_control_overlap",
  }),
  resolveNativePetDrop: vi.fn().mockResolvedValue({ kind: "hop", distance: 4, durationMs: 16, targetY: 0, ledge: "hop" }),
  setNativePetPresence: vi.fn().mockResolvedValue(undefined),
  getNativePetQuickControlsState: vi.fn().mockResolvedValue(null),
  listenToNativePetQuickControlsState: vi.fn().mockResolvedValue(vi.fn()),
  stalkNativePetCursor: vi.fn().mockResolvedValue({
    outcome: "completed",
    facing: "right",
    cursorX: 640,
    cursorY: 320,
    cursorMovementDistance: 0,
  }),
  returnWithNativePetCursor: vi.fn().mockResolvedValue({ outcome: "completed", movedDistance: 128 }),
  triggerNativePetVisibilityAction: vi.fn().mockResolvedValue(undefined),
  openNativePetModeMenu: vi.fn().mockResolvedValue(true),
  openNativePetTurnOffSuggestionMenu: vi.fn().mockResolvedValue(true),
  preloadPetModeHitRegions: vi.fn().mockResolvedValue(undefined),
  stagePetModeHitRegionTransition: vi.fn().mockResolvedValue(undefined),
  publishPetModeHitRegion: vi.fn().mockResolvedValue(undefined),
  onMoved: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("./petModeBridge", async (importOriginal) => ({
  // Keep the real low-level hit-region bridge through to the Tauri boundary.
  ...await importOriginal<typeof import("./petModeBridge")>(),
  alignNativePetContact: bridge.alignNativePetContact,
  beginNativePetDrag: bridge.beginNativePetDrag,
  cancelNativePetMotion: bridge.cancelNativePetMotion,
  listenToNativePetDragEnd: bridge.listenToNativePetDragEnd,
  listenToNativePetDragStart: bridge.listenToNativePetDragStart,
  listenToNativePetStrokeDetected: bridge.listenToNativePetStrokeDetected,
  listenToNativePetDragProbe: bridge.listenToNativePetDragProbe,
  listenToNativePetModeEvent: bridge.listenToNativePetModeEvent,
  listenToNativePetModeLabStateRequest: bridge.listenToNativePetModeLabStateRequest,
  moveNativePetToTarget: bridge.moveNativePetToTarget,
  reportNativePetContact: bridge.reportNativePetContact,
  reportNativePetDragError: bridge.reportNativePetDragError,
  reportNativePetModeLabState: bridge.reportNativePetModeLabState,
  reportNativePetPointer: bridge.reportNativePetPointer,
  returnNativePetHome: bridge.returnNativePetHome,
  finishNativePetFullscreenIntervention: bridge.finishNativePetFullscreenIntervention,
  exitNativePetScreen: bridge.exitNativePetScreen,
  prepareNativePetOutingHunt: bridge.prepareNativePetOutingHunt,
  returnNativePetFromOuting: bridge.returnNativePetFromOuting,
  roamNativePet: bridge.roamNativePet,
  sampleNativePetCursor: bridge.sampleNativePetCursor,
  isNativePetCursorInside: bridge.isNativePetCursorInside,
  isNativePetQuickControlsCursorInside: bridge.isNativePetQuickControlsCursorInside,
  listenToNativePetQuickControlsAction: bridge.listenToNativePetQuickControlsAction,
  listenToNativePetQuickControlsMenuState: bridge.listenToNativePetQuickControlsMenuState,
  setNativePetQuickControlsVisible: bridge.setNativePetQuickControlsVisible,
  triggerNativePetQuickControlsAction: bridge.triggerNativePetQuickControlsAction,
  reconcileNativePetPosition: bridge.reconcileNativePetPosition,
  rememberNativePetPosition: bridge.rememberNativePetPosition,
  probeNativePetAxSeat: bridge.probeNativePetAxSeat,
  resolveNativePetDrop: bridge.resolveNativePetDrop,
  setNativePetPresence: bridge.setNativePetPresence,
  getNativePetQuickControlsState: bridge.getNativePetQuickControlsState,
  listenToNativePetQuickControlsState: bridge.listenToNativePetQuickControlsState,
  stalkNativePetCursor: bridge.stalkNativePetCursor,
  returnWithNativePetCursor: bridge.returnWithNativePetCursor,
  triggerNativePetVisibilityAction: bridge.triggerNativePetVisibilityAction,
}));

vi.mock("./petModeNativeMenu", () => ({
  openNativePetModeMenu: bridge.openNativePetModeMenu,
  openNativePetTurnOffSuggestionMenu: bridge.openNativePetTurnOffSuggestionMenu,
}));

vi.mock("./petModeHitRegions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./petModeHitRegions")>();
  bridge.preloadPetModeHitRegions.mockImplementation(actual.preloadPetModeHitRegions);
  bridge.stagePetModeHitRegionTransition.mockImplementation(actual.stagePetModeHitRegionTransition);
  bridge.publishPetModeHitRegion.mockImplementation(actual.publishPetModeHitRegion);
  return {
  ...actual,
  preloadPetModeHitRegions: bridge.preloadPetModeHitRegions,
  stagePetModeHitRegionTransition: bridge.stagePetModeHitRegionTransition,
  publishPetModeHitRegion: bridge.publishPetModeHitRegion,
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onMoved: bridge.onMoved }),
}));


describe("pet activity lifecycle (mock native, simulated time)", () => {
  afterEach(() => {
    cleanup();
    if (vi.isMockFunction(window.setTimeout)) vi.mocked(window.setTimeout).mockRestore();
    if (vi.isMockFunction(window.requestAnimationFrame)) vi.mocked(window.requestAnimationFrame).mockRestore();
    if (vi.isMockFunction(Math.random)) vi.mocked(Math.random).mockRestore();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete (document as unknown as Record<string, unknown>).visibilityState;
    delete (document as unknown as Record<string, unknown>).hidden;
    window.localStorage.clear();
    bridge.eventHandler = null;
  });

  it.each([
    "focus", "neutral", "sleep", "cold-off", "hot-off",
    "hidden-document", "drift-only-away", "reduced-motion",
    "cold-off-no-snapshot", "away-fast-flush", "away-recovery", "focus-slow-native"
  ])("counts work for %s", async (scenario) => {
    vi.useFakeTimers({ now: new Date("2026-09-09T12:00:00Z") });
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    vi.stubGlobal("matchMedia", () => ({ matches: scenario === "reduced-motion" }));
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => ({
      ok: true,
      json: async () => String(input).includes("hit-regions") ? hitArtifact : { frames: walkFrames },
    })));
    window.localStorage.setItem(PET_OUTING_PREFERENCE_STORAGE_KEY, "0");
    const coldOff = scenario.startsWith("cold-off");
    const away = scenario === "drift-only-away" || scenario.startsWith("away-");
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, coldOff ? "0" : "1");
    if (away) window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, "drift_only");
    if (scenario === "sleep") {
      window.localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY,
        JSON.stringify(buildAutomaticCloseOverride(false, "60")));
    }
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler) => {
      bridge.eventHandler = handler; return vi.fn();
    });
    bridge.sampleNativePetCursor.mockResolvedValue({
      cursorX: 1000, cursorY: 600, windowX: 100, windowY: 50,
      windowWidth: 144, windowHeight: 120, visible: true,
    });
    bridge.isNativePetCursorInside.mockResolvedValue(false);
    bridge.isNativePetQuickControlsCursorInside.mockResolvedValue(false);
    if (scenario === "focus-slow-native") {
      bridge.sampleNativePetCursor.mockImplementation(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        return { cursorX: 1000, cursorY: 600, windowX: 100, windowY: 50,
          windowWidth: 144, windowHeight: 120, visible: true };
      });
    }
    const result = render(<PetModeWindowApp />);
    await act(async () => undefined);
    if (!coldOff) {
      await act(async () => bridge.eventHandler?.({ kind: "entry_complete" }));
    }
    const productivity = away || ["focus", "hidden-document", "reduced-motion", "focus-slow-native"].includes(scenario) ? "focus" : "neutral";
    if (scenario !== "cold-off-no-snapshot") await act(async () => bridge.eventHandler?.({
      kind: "snapshot",
      snapshot: { productivity, contextLabel: "fixture", durationSeconds: 3600 }
    }));
    if (scenario === "sleep") {
      await act(async () => bridge.eventHandler?.({ kind: "preview_action", action: "sleep" }));
    }
    if (scenario === "hot-off") {
      await act(async () => {
        window.localStorage.setItem(PET_MODE_STORAGE_KEY, "0");
        window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_STORAGE_KEY, newValue: "0" }));
      });
    }
    if (scenario === "hidden-document") {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    }
    if (away) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(bridge.setNativePetPresence).toHaveBeenCalledWith(false, 1);
      expect(result.container.querySelector(".pet-mode-cat")).toBeNull();
    }
    const setupPresenceCalls = [...bridge.setNativePetPresence.mock.calls];
    // Reset observations, preserving the native mock implementations above.
    vi.clearAllMocks();
    const phases = new Map<string, number>();
    let timeoutCallbacks = 0;
    let rafCallbacks = 0;
    const realSetTimeout = window.setTimeout.bind(window);
    const realRaf = window.requestAnimationFrame.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      realSetTimeout((...cbArgs: unknown[]) => {
        timeoutCallbacks++;
        if (typeof handler === "function") handler(...cbArgs);
      }, timeout, ...args)) as typeof window.setTimeout);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((handler) =>
      realRaf((time) => { rafCallbacks++; handler(time); }));
    const flushMs = scenario === "away-fast-flush" ? 16 : 250;
    for (let i = 0; i < 60_000 / flushMs; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(flushMs); });
      const phase = result.container.querySelector(".pet-mode-cat")?.getAttribute("data-phase") ?? "missing";
      phases.set(phase, (phases.get(phase) ?? 0) + flushMs);
    }
    const summary = {
      scenario, simulatedSeconds: 60, timeoutCallbacks, rafCallbacks,
      timersAtEnd: vi.getTimerCount(),
      cursorSample: bridge.sampleNativePetCursor.mock.calls.length,
      hitTest: bridge.isNativePetCursorInside.mock.calls.length,
      controlsHitTest: bridge.isNativePetQuickControlsCursorInside.mock.calls.length,
      axReconcile: bridge.reconcileNativePetPosition.mock.calls.length,
      stageHitRegion: bridge.stagePetModeHitRegionTransition.mock.calls.length,
      publishHitRegion: bridge.publishPetModeHitRegion.mock.calls.length,
      hitRegionIpc: ipc.invoke.mock.calls.filter(([command]) => command === "pet_mode_update_hit_region").length,
      nonemptyHitRegionIpc: ipc.invoke.mock.calls.filter(([command, args]) => command === "pet_mode_update_hit_region" && args.update.spans.length > 0).length,
      setupPresenceCalls,
      presenceCalls: bridge.setNativePetPresence.mock.calls,
      phasesMs: Object.fromEntries(phases),
    };
    if (away || coldOff || scenario === "hot-off") {
      expect(
        summary.timeoutCallbacks,
        "hidden/off pets should not keep a one-second autonomous-action retry alive",
      ).toBeLessThan(4);
      expect(summary.hitRegionIpc, "after setup, hidden/off pets should not republish an empty hit region").toBe(0);
      expect(summary.rafCallbacks, "hidden/off pets should not advance visual frames").toBe(0);
      expect(summary.stageHitRegion).toBe(0);
      expect(summary.publishHitRegion).toBe(0);
      expect(summary.cursorSample).toBe(0);
      expect(summary.hitTest).toBe(0);
      expect(summary.axReconcile).toBe(0);
      expect(summary.phasesMs).toEqual({ missing: 60_000 });
      expect(result.container.querySelector(".pet-mode-cat")).toBeNull();
    } else {
      expect(result.container.querySelector(".pet-mode-cat")).not.toBeNull();
    }
    // The visible cursor poll is unchanged by suspension. These characterize
    // that existing behavior; they are not a power-efficiency target.
    if (["focus", "sleep", "hidden-document", "reduced-motion"].includes(scenario)) {
      // 60,000 / 80ms = 750 polls with zero native response latency.
      expect(summary.cursorSample).toBe(750);
      expect(summary.hitTest).toBe(750);
    }
    if (scenario === "neutral") {
      expect(summary.cursorSample).toBeGreaterThan(summary.hitTest);
    }
    if (scenario === "focus-slow-native") {
      // The poll awaits native before rescheduling; this is NOT an unbounded
      // overlap/backlog. A 200ms reply slows the nominal 80ms poll to ~280ms.
      expect(summary.cursorSample).toBeLessThan(220);
      expect(summary.cursorSample).toBeGreaterThan(200);
    }
    if (scenario === "away-recovery") {
      // Turning the product off while already away must keep the renderer
      // suspended, not briefly restore the previous walking artwork.
      await act(async () => {
        window.localStorage.setItem(PET_MODE_STORAGE_KEY, "0");
        window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_STORAGE_KEY, newValue: "0" }));
      });
      ipc.invoke.mockClear();
      const rafAtOff = rafCallbacks;
      for (let i = 0; i < 40; i++) await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      expect(rafCallbacks).toBe(rafAtOff);
      expect(ipc.invoke).not.toHaveBeenCalledWith("pet_mode_update_hit_region", expect.anything());
      expect(result.container.querySelector(".pet-mode-cat")).toBeNull();
      await act(async () => {
        window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
        window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_STORAGE_KEY, newValue: "1" }));
        bridge.eventHandler?.({ kind: "reveal" });
        bridge.eventHandler?.({ kind: "entry_complete" });
      });
      for (let i = 0; i < 4; i++) await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      expect(result.container.querySelector(".pet-mode-cat")).not.toBeNull();
      expect(bridge.sampleNativePetCursor).toHaveBeenCalled();
      expect(ipc.invoke.mock.calls.some(([command, args]) => command === "pet_mode_update_hit_region" && args.update.spans.length > 0)).toBe(true);
    }
  }, 30_000);
});
