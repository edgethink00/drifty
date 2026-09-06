// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, buildAutomaticCloseOverride } from "../companion/automaticCloseOverride";
import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";
import { PetModeWindowApp } from "./PetModeWindowApp";
import {
  PET_MODE_BLINK_DURATION_MS,
  PET_MODE_DRAG_PICKUP_MS,
  PET_MODE_DRAG_SETTLE_MS,
  PET_MODE_ENTRY_DURATION_MS,
  PET_MODE_ENTRY_FALLBACK_GRACE_MS,
  PET_MODE_GAIT_BASELINE_SHIFT_PX,
  PET_MODE_GAIT_CENTER_SHIFT_PX,
  PET_MODE_LIFE_MOTION_DURATION_MS,
  PET_MODE_MUSIC_NOTE_DURATION_MS,
  PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY,
  PET_MODE_GUIDES_STORAGE_KEY,
  PET_MODE_PRESENT_MS,
  PET_MODE_POST_DROP_LOOK_DURATION_MS,
  PET_MODE_RUN_BETA_STORAGE_KEY,
  PET_MODE_SEAT_CLEAR_CONFIRM_MS,
  PET_MODE_SEAT_RECONCILE_INTERVAL_MS,
  PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS,
  PET_MODE_STORAGE_KEY,
  PET_MODE_HIDDEN_UNTIL_STORAGE_KEY,
  PET_MODE_TAIL_FLICK_DURATION_MS,
  PET_MODE_LIFE_ACTION_INTERVAL_MS,
  type PetModeOutingTicket,
  type PetModeWindowEvent,
} from "./petModeData";
import {
  DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
  PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY,
  PET_MODE_DRIFT_CURSOR_BITE_HOLD_MS,
  PET_MODE_DRIFT_HUNT_ALERT_MS,
  PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY,
  PET_MODE_DRIFT_NOTICE_MS,
  PET_MODE_DRIFT_NOTICE_SECONDS,
  PET_MODE_DRIFT_SLEEP_EXPRESSION_PREVIEW_MS,
  PET_MODE_DRIFT_SLEEP_FULL_PREVIEW_HOLD_MS,
  PET_MODE_DRIFT_SLEEP_NOTICE_MS,
  PET_MODE_DRIFT_SLEEP_PREVIEW_SETTLE_MS,
  PET_MODE_DRIFT_SLEEP_WAKE_MS,
  PET_MODE_DRIFT_STALK_SETTLE_MS,
  PET_MODE_DRIFT_STALK_SECONDS,
} from "./petModeDriftHunt";
import {
  PET_QUICK_CONTROLS_HOVER_OPEN_MS,
  PET_QUICK_CONTROLS_INTERACTION_COOLDOWN_MS,
  PET_QUICK_CONTROLS_POLL_MS,
} from "./petModeQuickControls";
import { PET_OUTING_PREFERENCE_STORAGE_KEY } from "./petOutingPreference";

const walkFrames = (JSON.parse(
  readFileSync("public/pet-mode/walk-frames-v2.json", "utf8"),
) as { readonly frames: readonly string[] }).frames;

function dispatchPointer(
  target: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { readonly button?: number; readonly pointerId: number; readonly clientX: number; readonly clientY: number },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: init.button ?? 0 },
    pointerId: { value: init.pointerId },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
  });
  fireEvent(target, event);
  return event;
}

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
  preloadPetModeHitRegions: vi.fn().mockResolvedValue(undefined),
  stagePetModeHitRegionTransition: vi.fn().mockResolvedValue(undefined),
  publishPetModeHitRegion: vi.fn().mockResolvedValue(undefined),
  onMoved: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("./petModeBridge", () => ({
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
}));

vi.mock("./petModeHitRegions", () => ({
  preloadPetModeHitRegions: bridge.preloadPetModeHitRegions,
  stagePetModeHitRegionTransition: bridge.stagePetModeHitRegionTransition,
  publishPetModeHitRegion: bridge.publishPetModeHitRegion,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onMoved: bridge.onMoved }),
}));

describe("PetModeWindowApp", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    if (vi.isMockFunction(Math.random)) vi.mocked(Math.random).mockRestore();
    vi.clearAllMocks();
    bridge.sampleNativePetCursor.mockReset().mockResolvedValue(null);
    bridge.isNativePetCursorInside.mockReset().mockResolvedValue(false);
    bridge.isNativePetQuickControlsCursorInside.mockReset().mockResolvedValue(false);
    bridge.setNativePetQuickControlsVisible.mockReset().mockResolvedValue(undefined);
    bridge.stagePetModeHitRegionTransition.mockReset().mockResolvedValue(undefined);
    bridge.dragEndHandler = null;
    bridge.dragStartHandler = null;
    bridge.strokeDetectedHandler = null;
    bridge.eventHandler = null;
    bridge.quickControlsMenuStateHandler = null;
    window.localStorage.clear();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.surface;
  });

  it("shows fullscreen arrival beats only for the active, uninterrupted attempt", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishMove!: (result: object) => void;
    bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise((resolve) => { finishMove = resolve; }));
    const { container } = render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "intervention", target: {
      id: "arrival", appName: "Safari", browserName: "Safari", preview: false,
    } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { bridge.eventHandler?.({ kind: "motion", motion: "walk" }); });
    act(() => bridge.eventHandler?.({ kind: "fullscreen_beat", id: "older", phase: "notice" }));
    expect(container.querySelector(".pet-mode-cat--walk")).not.toBeNull();
    await act(async () => { bridge.eventHandler?.({ kind: "fullscreen_beat", id: "arrival", phase: "pause" }); });
    expect(container.querySelector(".pet-mode-cat--idle")).not.toBeNull();
    await act(async () => { bridge.eventHandler?.({ kind: "fullscreen_beat", id: "arrival", phase: "notice" }); });
    expect(container.querySelector(".pet-mode-cat--notice")).not.toBeNull();
    await act(async () => {
      dispatchPointer(screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." }),
        "pointerdown", { pointerId: 41, clientX: 60, clientY: 50 });
      bridge.dragStartHandler?.();
    });
    await act(async () => { bridge.eventHandler?.({ kind: "fullscreen_beat", id: "arrival", phase: "notice" }); });
    expect(container.querySelector(".pet-mode-cat--notice")).toBeNull();
    await act(async () => {
      finishMove({ motionOutcome: "cancelled" });
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(bridge.reportNativePetContact).not.toHaveBeenCalledWith("arrival");
  });

  it("finishes the full-screen scene after paw contact without running the ordinary return twice", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.finishNativePetFullscreenIntervention.mockResolvedValueOnce(true);
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "intervention", target: {
      id: "fullscreen-contact", appName: "Safari", browserName: "Safari", preview: false,
    } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("fullscreen-contact");
    expect(bridge.finishNativePetFullscreenIntervention).toHaveBeenCalledWith("fullscreen-contact", false);
    expect(bridge.returnNativePetHome).not.toHaveBeenCalled();
  });

  it("preserves a pickup after contact when fullscreen cleanup starts", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let acknowledgeContact!: () => void;
    bridge.reportNativePetContact.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledgeContact = resolve; }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "intervention", target: {
      id: "pickup-after-contact", appName: "Safari", browserName: "Safari", preview: false,
    } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("pickup-after-contact");
    await act(async () => { dispatchPointer(screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." }), "pointerdown", { pointerId: 42, clientX: 60, clientY: 50 }); bridge.dragStartHandler?.(); });
    await act(async () => { acknowledgeContact(); await vi.advanceTimersByTimeAsync(1000); });
    expect(bridge.finishNativePetFullscreenIntervention).toHaveBeenCalledWith("pickup-after-contact", true);
    expect(bridge.returnNativePetHome).not.toHaveBeenCalled();
  });

  it("delivers a catch result before retiring the fullscreen attempt", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishMove!: (result: object) => void;
    let acknowledgeCatch!: () => void;
    bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise((resolve) => { finishMove = resolve; }));
    bridge.reportNativePetContact.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledgeCatch = resolve; }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "intervention", target: {
      id: "pending-catch", appName: "Safari", browserName: "Safari", preview: false,
    } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); dispatchPointer(screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." }), "pointerdown", { pointerId: 42, clientX: 60, clientY: 50 }); bridge.dragStartHandler?.(); });
    await act(async () => { finishMove({ motionOutcome: "cancelled" }); });
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("pending-catch", false, "user_intercepted");
    expect(bridge.finishNativePetFullscreenIntervention).not.toHaveBeenCalled();
    await act(async () => { acknowledgeCatch(); });
    expect(bridge.finishNativePetFullscreenIntervention).toHaveBeenCalledWith("pending-catch", true);
  });

  it("renders native pause and restore even when disk keeps the opposite choice", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const until = Date.now() + 900_000;
    const state = { automaticCloseEnabled: false, automaticCloseSavedEnabled: true,
      automaticCloseOverride: { enabled: false, kind: "15" as const, endsAtMs: until },
      language: "en" as const, theme: "light" as const };
    let receive!: (nextState: { automaticCloseEnabled: boolean; automaticCloseSavedEnabled: boolean;
      automaticCloseOverride: typeof state.automaticCloseOverride | null; language: "en"; theme: "light" }) => void;
    bridge.getNativePetQuickControlsState.mockResolvedValueOnce(state);
    bridge.listenToNativePetQuickControlsState.mockImplementationOnce(async (handler) => { receive = handler; return vi.fn(); });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    window.localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify(buildAutomaticCloseOverride(false, "15")));
    await act(async () => receive({ ...state, automaticCloseEnabled: true, automaticCloseOverride: null }));
    expect(cat.getAttribute("data-phase")).toBe("idle");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  async function mountTimedPause(kind: "15" | "60" | "today" | "forever" = "15", enabled = false) {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify(buildAutomaticCloseOverride(enabled, kind)));
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    await act(async () => bridge.eventHandler?.({ kind: "entry_complete" }));
    return screen.getByLabelText("Drifty pet cat");
  }

  it.each(["15", "60", "today"] as const)("sleeps for the whole %s pause through focus, drift and touch", async (kind) => {
    const cat = await mountTimedPause(kind);
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    for (const productivity of ["focus", "drift", "neutral"] as const) {
      await act(async () => bridge.eventHandler?.({ kind: "snapshot", snapshot: { productivity, contextLabel: "fixture", durationSeconds: 180 } }));
      expect(cat.getAttribute("data-phase")).toBe("sleep");
    }
    const pet = screen.getByRole("button", { name: /Pet Drifty cat/ });
    for (let i = 0; i < 3; i++) {
      await act(async () => { dispatchPointer(pet, "pointerdown", { pointerId: i, clientX: 18, clientY: 18 }); });
    }
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.querySelector(".pet-mode-cat__sleep-pose")).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(14 * 60_000 + 1); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(bridge.roamNativePet).not.toHaveBeenCalled();
    expect(bridge.exitNativePetScreen).not.toHaveBeenCalled();
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
  }, 20_000);

  it.each([["forever", false], ["15", true]] as const)("does not force sleep for %s enabled=%s", async (kind, enabled) => {
    const cat = await mountTimedPause(kind, enabled);
    expect(cat.getAttribute("data-phase")).not.toBe("sleep");
  });

  it("keeps the same sleep artwork and facing through native pickup, shake and release", async () => {
    const cat = await mountTimedPause();
    let completeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise((resolve) => {
      completeDrag = () => resolve({ moved: true, shakeDetected: true, startX: 120, startY: 80, endX: 180, endY: 96 });
    }));
    const pose = cat.querySelector(".pet-mode-cat__sleep-pose");
    const facing = cat.classList.contains("is-mirrored");
    await act(async () => { dispatchPointer(screen.getByRole("button", { name: /Pet Drifty cat/ }), "pointerdown", { pointerId: 31, clientX: 18, clientY: 18 }); });
    await act(async () => bridge.dragStartHandler?.());
    expect(bridge.beginNativePetDrag).toHaveBeenLastCalledWith(18, 18, 0);
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    await act(async () => bridge.eventHandler?.({ kind: "facing", facing: facing ? "right" : "left" }));
    expect(cat.classList.contains("is-mirrored")).toBe(facing);
    await act(async () => completeDrag());
    expect(cat.querySelector(".pet-mode-cat__sleep-pose")).toBe(pose);
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.querySelector(".pet-mode-cat__drag-pending-rest")).toBeNull();
    expect(bridge.resolveNativePetDrop).toHaveBeenLastCalledWith(false);
    expect(bridge.rememberNativePetPosition).toHaveBeenLastCalledWith(true);
    expect(bridge.roamNativePet).not.toHaveBeenCalled();
  });

  it("uses the existing pause deadline, extension and restore across webviews", async () => {
    const cat = await mountTimedPause();
    await act(async () => { await vi.advanceTimersByTimeAsync(14 * 60_000); });
    const extension = buildAutomaticCloseOverride(false, "60");
    await act(async () => {
      window.localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify(extension));
      window.dispatchEvent(new StorageEvent("storage", { key: AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_001); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    await act(async () => {
      window.localStorage.removeItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY }));
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  }, 20_000);

  it("keeps sleep through expiry during a drag and wakes only after placement", async () => {
    const cat = await mountTimedPause();
    let completeDrag!: () => void;
    let completeDrop!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise((resolve) => {
      completeDrag = () => resolve({ moved: true, startX: 120, startY: 80, endX: 180, endY: 96 });
    }));
    bridge.resolveNativePetDrop.mockImplementationOnce(() => new Promise((resolve) => {
      completeDrop = () => resolve(null);
    }));
    const pet = screen.getByRole("button", { name: /Pet Drifty cat/ });
    await act(async () => { dispatchPointer(pet, "pointerdown", { pointerId: 61, clientX: 18, clientY: 18 }); bridge.dragStartHandler?.(); });
    await act(async () => {
      vi.setSystemTime(Date.now() + 15 * 60_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    await act(async () => completeDrag());
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    const calls = bridge.beginNativePetDrag.mock.calls.length;
    await act(async () => { dispatchPointer(pet, "pointerdown", { pointerId: 62, clientX: 18, clientY: 18 }); });
    expect(bridge.beginNativePetDrag.mock.calls.length).toBe(calls);
    await act(async () => completeDrop());
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("releases sleep ownership when a pause begins and expires during an ordinary drop", async () => {
    const cat = await mountTimedPause("forever");
    let completeDrag!: () => void;
    let completeDrop!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise((resolve) => {
      completeDrag = () => resolve({ moved: true, startX: 120, startY: 80, endX: 180, endY: 96 });
    }));
    bridge.resolveNativePetDrop.mockImplementationOnce(() => new Promise((resolve) => {
      completeDrop = () => resolve(null);
    }));
    await act(async () => { dispatchPointer(screen.getByRole("button", { name: /Pet Drifty cat/ }), "pointerdown", { pointerId: 71, clientX: 18, clientY: 18 }); bridge.dragStartHandler?.(); });
    await act(async () => completeDrag());
    expect(cat.getAttribute("data-phase")).toBe("release");
    await act(async () => {
      window.localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify(buildAutomaticCloseOverride(false, "15")));
      window.dispatchEvent(new StorageEvent("storage", { key: AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY }));
    });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    await act(async () => {
      vi.setSystemTime(Date.now() + 15 * 60_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    await act(async () => completeDrop());
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledWith(true);
  });

  it("respects reduced motion while placing a sleeping cat", async () => {
    const cat = await mountTimedPause();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.beginNativePetDrag.mockResolvedValueOnce({ moved: true, startX: 120, startY: 80, endX: 180, endY: 96 });
    await act(async () => dispatchPointer(screen.getByRole("button", { name: /Pet Drifty cat/ }), "pointerdown", { pointerId: 91, clientX: 18, clientY: 18 }));
    expect(bridge.resolveNativePetDrop).not.toHaveBeenCalled();
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledWith(true);
    expect(cat.getAttribute("data-phase")).toBe("sleep");
  });

  it("settles a sleeping drag once when native emits completion before resolving the invoke", async () => {
    const cat = await mountTimedPause();
    const result = { moved: true, startX: 120, startY: 80, endX: 180, endY: 96 };
    let completeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise((resolve) => { completeDrag = () => resolve(result); }));
    await act(async () => dispatchPointer(screen.getByRole("button", { name: /Pet Drifty cat/ }), "pointerdown", { pointerId: 92, clientX: 18, clientY: 18 }));
    await act(async () => bridge.dragEndHandler?.(result));
    await act(async () => completeDrag());
    expect(bridge.resolveNativePetDrop).toHaveBeenCalledTimes(1);
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);
    expect(cat.getAttribute("data-phase")).toBe("sleep");
  });

  it("enters sleep on a new cross-window pause and ignores queued motion and drift cues", async () => {
    const cat = await mountTimedPause("forever");
    expect(cat.getAttribute("data-phase")).not.toBe("sleep");
    bridge.setNativePetPresence.mockClear();
    await act(async () => {
      window.localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify(buildAutomaticCloseOverride(false, "15")));
      window.dispatchEvent(new StorageEvent("storage", { key: AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY }));
    });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(bridge.setNativePetPresence).not.toHaveBeenCalled();
    const pose = cat.querySelector(".pet-mode-cat__sleep-pose");
    await act(async () => {
      bridge.eventHandler?.({ kind: "motion", motion: "walk" });
      bridge.eventHandler?.({ kind: "snapshot", snapshot: { productivity: "drift", contextLabel: "fixture", durationSeconds: 180 } });
    });
    expect(cat.querySelector(".pet-mode-cat__sleep-pose")).toBe(pose);
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(false);
  });

  it("discards a facing transition queued before a timed pause", async () => {
    const cat = await mountTimedPause("forever");
    const facing = cat.classList.contains("is-mirrored");
    let completeFacing!: () => void;
    bridge.stagePetModeHitRegionTransition.mockImplementationOnce(() => new Promise<void>((resolve) => { completeFacing = resolve; }));
    await act(async () => bridge.eventHandler?.({ kind: "facing", facing: facing ? "right" : "left" }));
    await act(async () => {
      localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify(buildAutomaticCloseOverride(false, "15")));
      window.dispatchEvent(new StorageEvent("storage", { key: AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY }));
    });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    await act(async () => completeFacing());
    expect(cat.classList.contains("is-mirrored")).toBe(facing);
  });

  it("recovers when native drag fails after an intervening pause has expired", async () => {
    const cat = await mountTimedPause("forever");
    let failDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      failDrag = () => reject(new Error("native drag failed"));
    }));
    await act(async () => dispatchPointer(screen.getByRole("button", { name: /Pet Drifty cat/ }), "pointerdown", { pointerId: 81, clientX: 18, clientY: 18 }));
    await act(async () => {
      localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify(buildAutomaticCloseOverride(false, "15")));
      window.dispatchEvent(new StorageEvent("storage", { key: AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY }));
    });
    await act(async () => {
      vi.setSystemTime(Date.now() + 900_000);
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => failDrag());
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("wakes at expiry without another activity snapshot", async () => {
    const cat = await mountTimedPause();
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  }, 20_000);

  it("rechecks the resident seat when the opaque app/window revision changes", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: {
          productivity: "neutral",
          contextLabel: "editor",
          durationSeconds: 1,
          surfaceRevision: 101,
        },
      });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(bridge.reconcileNativePetPosition).not.toHaveBeenCalled();

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: {
          productivity: "neutral",
          contextLabel: "browser",
          durationSeconds: 1,
          surfaceRevision: 202,
        },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await Promise.resolve();
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledWith(false);
  });

  it("periodically rechecks a still cat when controls change without a new window title", async () => {
    // Keep the first random blink (4.42-7.28s) beyond this assertion. If a
    // blink overlaps the 6s interval, production deliberately waits for the
    // short pose to finish before moving the pet, which is a different case.
    vi.spyOn(Math, "random").mockReturnValue(1);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    expect(bridge.eventHandler).not.toBeNull();
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_SEAT_RECONCILE_INTERVAL_MS);
      // The interval callback schedules a short coalescing debounce.
      await vi.advanceTimersByTimeAsync(150);
      await Promise.resolve();
    });

    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledWith(false);
  });

  it("quickly confirms a clear anchor without trusting one transient AX miss", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.reconcileNativePetPosition
      .mockResolvedValueOnce({ x: 1440, y: 47, moved: false, reason: "anchor_clear_pending" })
      .mockResolvedValueOnce({ x: 1560, y: 47, moved: true, reason: "no_control_overlap" });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_SEAT_RECONCILE_INTERVAL_MS + 120);
      await Promise.resolve();
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_SEAT_CLEAR_CONFIRM_MS - 1);
      await Promise.resolve();
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledTimes(2);
  });

  it("keeps the clear-confirm delay when a surface change arrives during an AX scan", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeFirstScan!: () => void;
    bridge.reconcileNativePetPosition
      .mockImplementationOnce(() => new Promise((resolve) => {
        completeFirstScan = () => resolve({
          x: 1440,
          y: 47,
          moved: false,
          reason: "anchor_clear_pending",
        });
      }))
      .mockResolvedValueOnce({
        x: 1560,
        y: 47,
        moved: true,
        reason: "no_control_overlap",
      });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: {
          productivity: "neutral",
          contextLabel: "browser",
          durationSeconds: 1,
          surfaceRevision: 101,
        },
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_SEAT_RECONCILE_INTERVAL_MS + 120);
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledTimes(1);

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: {
          productivity: "neutral",
          contextLabel: "browser",
          durationSeconds: 1,
          surfaceRevision: 202,
        },
      });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledTimes(1);

    await act(async () => {
      completeFirstScan();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_SEAT_CLEAR_CONFIRM_MS - 1);
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledTimes(2);
  });

  it("rechecks the final seat when an intervention supersedes an in-flight AX scan", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeFirstScan!: () => void;
    bridge.reconcileNativePetPosition
      .mockImplementationOnce(() => new Promise((resolve) => {
        completeFirstScan = () => resolve({
          x: 120,
          y: 80,
          moved: false,
          reason: "motion_superseded",
        });
      }))
      .mockResolvedValueOnce({
        x: 120,
        y: 80,
        moved: false,
        reason: "no_control_overlap",
      });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_SEAT_RECONCILE_INTERVAL_MS + 120);
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledTimes(1);

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drift-seat-race",
          appName: "Aside",
          browserName: "Aside",
          preview: false,
        },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("paw");

    await act(async () => {
      completeFirstScan();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledTimes(2);
  });

  it("retries a periodic AX recheck after a blink temporarily blocks movement", async () => {
    // 0.517 schedules the first blink at about 5.9s, so the 6s AX interval
    // lands during the pose and must be retried after the 228ms blink settles.
    vi.spyOn(Math, "random").mockReturnValue(0.517);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(5_900); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("blink");

    // The 6s interval and its 120ms debounce both fire before this clock turn
    // ends, while the blink still owns the pose.
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(bridge.reconcileNativePetPosition).not.toHaveBeenCalled();

    // Let the blink finish in its own turn, as it does with real timers, so
    // the phase effect can reschedule the pending AX request.
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
      await Promise.resolve();
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledWith(false);
  });

  it("hard-stops automatic motion while focus is active", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    bridge.sampleNativePetCursor.mockClear();

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 42 },
      });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("sit");
    expect(bridge.cancelNativePetMotion).toHaveBeenCalledTimes(1);

    act(() => {
      bridge.eventHandler?.({ kind: "motion", motion: "walk" });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_PRESENT_MS + 20_000); });
    expect(cat.getAttribute("data-phase")).toBe("sit");
    expect(bridge.roamNativePet).not.toHaveBeenCalled();
  });

  it("keeps quick controls hoverable while focus seats the cat and retries a failed show", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let cursorX = 600;
    bridge.sampleNativePetCursor.mockImplementation(async () => ({
      cursorX: cursorX += 3,
      cursorY: 330,
      windowX: 560,
      windowY: 280,
      windowWidth: 144,
      windowHeight: 99,
      visible: true,
    }));
    bridge.isNativePetCursorInside.mockResolvedValue(false);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 42 },
      });
    });
    bridge.setNativePetQuickControlsVisible.mockClear();
    bridge.setNativePetQuickControlsVisible
      .mockRejectedValueOnce(new Error("transient native window failure"))
      .mockResolvedValue(undefined);
    bridge.isNativePetCursorInside.mockResolvedValue(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();
    });

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");
    expect(bridge.setNativePetQuickControlsVisible.mock.calls.filter(([visible]) => visible)).toHaveLength(2);
  });

  it("lets a bounded AX seat correction walk during focus", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 42 },
      });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("sit");
    await act(async () => {
      bridge.eventHandler?.({
        kind: "motion",
        motion: "walk",
        purpose: "seat_correction",
      });
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("walk");
  });

  it("enters the focus rest pose when the pet is enabled during an active focus episode", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 12 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.cancelNativePetMotion).not.toHaveBeenCalled();

    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_STORAGE_KEY,
        newValue: "1",
      }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");
    expect(bridge.cancelNativePetMotion).toHaveBeenCalledTimes(1);
  });

  it("hard-stops an in-flight automatic intervention when focus starts", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishMove!: () => void;
    bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise((resolve) => {
      finishMove = () => resolve({
        facing: "right",
        targetKind: "browser_tab_close",
        motionOutcome: "completed",
        confidence: "high",
        diagnostic: "ax_selected_tab_close",
        targetX: 640,
        targetY: 48,
      });
    }));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "automatic-drift-nudge",
          appName: "Google Chrome",
          browserName: "Google Chrome",
          preview: false,
        },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.moveNativePetToTarget).toHaveBeenCalledTimes(1);

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 1 },
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(bridge.cancelNativePetMotion).toHaveBeenCalled();
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "neutral", contextLabel: "editor", durationSeconds: 2 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");

    await act(async () => {
      finishMove();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("automatic-drift-nudge", false, "activity_context_changed");
    expect(bridge.reportNativePetContact).not.toHaveBeenCalledWith("automatic-drift-nudge");
    expect(bridge.returnNativePetHome).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("reserves user_intercepted for a real pointer catch", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishMove!: () => void;
    bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise((resolve) => {
      finishMove = () => resolve({
        facing: "right",
        targetKind: "browser_tab_close",
        motionOutcome: "completed",
        confidence: "high",
        diagnostic: "ax_selected_tab_close",
        targetX: 640,
        targetY: 48,
      });
    }));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "automatic-caught-nudge",
          appName: "Google Chrome",
          browserName: "Google Chrome",
          preview: false,
        },
      });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 41, clientX: 12, clientY: 12 });
    await act(async () => {
      finishMove();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.reportNativePetContact).toHaveBeenCalledTimes(1);
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith(
      "automatic-caught-nudge",
      false,
      "user_intercepted",
    );
  });

  it("stands up for an automatic close and for an explicit Lab X target while sitting in focus", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise(() => undefined));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 42 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");

    // The alarm has already cleared its AI gate and re-confirmed the live
    // target before this arrives, so this window's seated pose is the older
    // truth. Vetoing here only removed the cat from a close that ran anyway.
    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "automatic-while-focused",
          appName: "Google Chrome",
          browserName: "Google Chrome",
          preview: false,
        },
      });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.moveNativePetToTarget).toHaveBeenCalledTimes(1);
    expect(bridge.reportNativePetContact).not.toHaveBeenCalledWith(
      "automatic-while-focused",
      false,
      "renderer_focus_resting",
    );
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("run");

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "lab-browser-x-while-focused",
          appName: "Google Chrome",
          browserName: "Google Chrome",
          preview: false,
          labTarget: "browser_tab_x",
        },
      });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(bridge.cancelNativePetMotion).toHaveBeenCalled();
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("run");
  });

  it("runs the 2026-08-30 close instead of answering renderer_focus_resting in 19ms", async () => {
    // Real capture: the alarm confirmed the live YouTube target, sent the cat,
    // got "renderer_focus_resting elapsedMs=19" back, and closed the tab
    // anyway. The user saw a tab vanish with the cat still sitting. The seated
    // pose must never be the thing that answers an automatic target.
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise(() => undefined));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "Codex", durationSeconds: 1200 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drift-episode:19618",
          appName: "Aside",
          browserName: "Aside",
          preview: false,
        },
      });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(bridge.reportNativePetContact).not.toHaveBeenCalled();
    expect(bridge.moveNativePetToTarget).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("run");
  });

  it("accepts the native run gait after standing up from a focus sit", async () => {
    // Native emits its own facing/motion events while it walks the panel. The
    // motion handler drops them while the window still believes it is resting,
    // so standing up has to clear that state as well; otherwise the cat slides
    // across the screen in its seated pose.
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise(() => undefined));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "Codex", durationSeconds: 900 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drift-episode:native-gait",
          appName: "Aside",
          browserName: "Aside",
          preview: false,
        },
      });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => bridge.eventHandler?.({ kind: "motion", motion: "run" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("run");

    // Native keeps emitting gait frames for the whole trip. A late snapshot
    // that still says "focus" must not be able to reseat the cat mid-run,
    // because the alarm already re-checked the live target before sending it.
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "Codex", durationSeconds: 930 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    act(() => bridge.eventHandler?.({ kind: "motion", motion: "run" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("run");
  });

  it("keeps the newer Lab intervention active when an interrupted tail preview finishes", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise(() => undefined));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "tail_flick" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("tail");

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "lab-browser-x-during-tail",
          appName: "Google Chrome",
          browserName: "Google Chrome",
          preview: false,
          labTarget: "browser_tab_x",
        },
      });
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });

    const labStateCalls = bridge.reportNativePetModeLabState.mock.calls;
    const latestLabState = labStateCalls[labStateCalls.length - 1]?.[0];
    expect(latestLabState?.activeAction).toBe("intervention");
    expect(bridge.moveNativePetToTarget).toHaveBeenCalledTimes(1);
  });

  it("notices a drift episode once, then bites and returns with a stationary cursor once", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem("drifty.pet.driftHuntEnabled.v1", "true");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let finishStalk!: () => void;
    let finishCarry!: () => void;
    bridge.stalkNativePetCursor.mockImplementationOnce(() => new Promise((resolve) => {
      finishStalk = () => resolve({
        outcome: "completed",
        facing: "right",
        cursorX: 640,
        cursorY: 320,
        cursorMovementDistance: 0,
      });
    }));
    bridge.returnWithNativePetCursor.mockImplementationOnce(() => new Promise((resolve) => {
      finishCarry = () => resolve({ outcome: "completed", movedDistance: 128 });
    }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    bridge.sampleNativePetCursor.mockClear();

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_NOTICE_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("notice");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_NOTICE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(bridge.sampleNativePetCursor).not.toHaveBeenCalled();

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("stalk");
    expect(bridge.stalkNativePetCursor).toHaveBeenCalledTimes(1);
    expect(bridge.stalkNativePetCursor).toHaveBeenCalledWith({
      ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
      enabled: true,
      mode: "single",
      chaseDurationMs: 2_500,
      softTurns: true,
      showAlertCue: true,
    });
    expect(cat.classList.contains("has-hunt-alert")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_HUNT_ALERT_MS - 1); });
    expect(cat.classList.contains("has-hunt-alert")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(cat.classList.contains("has-hunt-alert")).toBe(false);

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS + 5 },
      });
    });
    expect(bridge.stalkNativePetCursor).toHaveBeenCalledTimes(1);
    await act(async () => { finishStalk(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("bite");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_CURSOR_BITE_HOLD_MS - 1); });
    expect(bridge.returnWithNativePetCursor).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(bridge.returnWithNativePetCursor).toHaveBeenCalledWith({
      targetX: 640,
      targetY: 320,
      approachFacing: "right",
      cursorMovementDistance: 0,
      settings: { ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS, enabled: true },
    });
    await act(async () => {
      bridge.eventHandler?.({ kind: "facing", facing: "left" });
      bridge.eventHandler?.({ kind: "motion", motion: "return" });
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("return");
    await act(async () => { finishCarry(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(cat.getAttribute("data-phase")).toBe("sit");
  });

  it("starts a hunt when the first drift snapshot is already past the stalk threshold", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY, "true");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.stalkNativePetCursor.mockImplementationOnce(() => new Promise(() => undefined));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: {
          productivity: "drift",
          contextLabel: "video",
          durationSeconds: PET_MODE_DRIFT_STALK_SECONDS + 6,
        },
      });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("stalk");
    expect(bridge.stalkNativePetCursor).toHaveBeenCalledTimes(1);
  });

  it("notices drift in place while asleep, then rises directly into the committed hunt", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY, "true");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.stalkNativePetCursor.mockImplementationOnce(() => new Promise(() => undefined));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "sleep" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_NOTICE_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("has-sleep-drift-cue")).toBe(true);
    expect(cat.classList.contains("is-sleep-notice")).toBe(true);
    expect(cat.classList.contains("has-hunt-alert")).toBe(false);
    expect(cat.querySelector(".pet-mode-cat__sleep-eyes--squint")).not.toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_NOTICE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("has-sleep-drift-cue")).toBe(true);
    expect(cat.classList.contains("is-sleep-notice")).toBe(true);
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(true);

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "neutral", contextLabel: "work", durationSeconds: 0 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(false);
    expect(cat.classList.contains("has-sleep-drift-cue")).toBe(false);

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("is-sleep-wake")).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_WAKE_MS - 1); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(true);
    expect(cat.classList.contains("has-hunt-alert")).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("stalk");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(false);
    expect(cat.classList.contains("has-hunt-alert")).toBe(true);
    expect(bridge.stalkNativePetCursor).toHaveBeenCalledTimes(1);
  });

  it("keeps the approved sleeping drift reaction active while cursor control is off", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "sleep" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_NOTICE_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_NOTICE_MS); });
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("is-sleep-wake")).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_WAKE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("stalk");
    expect(cat.classList.contains("has-hunt-alert")).toBe(true);
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
    expect(bridge.returnWithNativePetCursor).not.toHaveBeenCalled();

    const cancellationCount = bridge.cancelNativePetMotion.mock.calls.length;
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: DEV_MODE_STORAGE_KEY,
        newValue: "0",
      }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("stalk");
    expect(cat.classList.contains("has-hunt-alert")).toBe(true);
    expect(bridge.cancelNativePetMotion).toHaveBeenCalledTimes(cancellationCount);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_STALK_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(cat.classList.contains("has-hunt-alert")).toBe(false);
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
    expect(bridge.returnWithNativePetCursor).not.toHaveBeenCalled();
  });

  it("keeps a sleeping drift reaction alive when cursor control is turned off mid-episode", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY, "true");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "sleep" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_NOTICE_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(true);

    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY, "false");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY,
        newValue: "false",
      }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(true);

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_WAKE_MS); });

    expect(cat.getAttribute("data-phase")).toBe("stalk");
    expect(cat.classList.contains("has-hunt-alert")).toBe(true);
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
    expect(bridge.returnWithNativePetCursor).not.toHaveBeenCalled();
  });

  it("replays the sleeping notice through the bounded Dev QA action", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "sleep_drift_notice" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("has-sleep-drift-cue")).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_PREVIEW_SETTLE_MS); });
    expect(cat.classList.contains("is-sleep-notice")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_NOTICE_MS); });
    expect(cat.classList.contains("has-sleep-drift-cue")).toBe(true);
    expect(cat.classList.contains("is-sleep-notice")).toBe(true);
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(true);
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        PET_MODE_DRIFT_SLEEP_EXPRESSION_PREVIEW_MS - PET_MODE_DRIFT_SLEEP_NOTICE_MS,
      );
    });
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(false);
    expect(cat.classList.contains("has-sleep-drift-cue")).toBe(false);
  });

  it("previews the complete sleeping drift escalation without moving the native cursor", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "sleep_drift_full_preview" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_PREVIEW_SETTLE_MS); });
    expect(cat.classList.contains("is-sleep-notice")).toBe(true);
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_NOTICE_MS); });
    expect(cat.classList.contains("has-sleep-drift-cue")).toBe(true);
    expect(cat.classList.contains("is-sleep-notice")).toBe(true);
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_FULL_PREVIEW_HOLD_MS); });
    expect(cat.classList.contains("is-sleep-wake")).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_WAKE_MS - 1); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(true);
    expect(cat.classList.contains("has-hunt-alert")).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(cat.getAttribute("data-phase")).toBe("stalk");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(false);
    expect(cat.classList.contains("has-hunt-alert")).toBe(true);
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
    expect(bridge.returnWithNativePetCursor).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_HUNT_ALERT_MS); });
    expect(cat.classList.contains("has-hunt-alert")).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_STALK_SETTLE_MS - PET_MODE_DRIFT_HUNT_ALERT_MS);
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("does not leak an interrupted full-preview expression into the next sleep", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "sleep_drift_full_preview" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        PET_MODE_DRIFT_SLEEP_PREVIEW_SETTLE_MS + PET_MODE_DRIFT_SLEEP_NOTICE_MS,
      );
    });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(true);
    expect(cat.classList.contains("has-sleep-drift-cue")).toBe(true);

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "stop" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(false);
    expect(cat.classList.contains("has-sleep-drift-cue")).toBe(false);

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "sleep" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(false);
    expect(cat.classList.contains("has-sleep-drift-cue")).toBe(false);
  });

  it("keeps the annoyed sleeping face until the staged stalk artwork is ready", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let finishStalkTransition!: () => void;
    bridge.stagePetModeHitRegionTransition.mockImplementation(async ({ regionId }) => {
      if (regionId !== "transition:stalk") return;
      await new Promise<void>((resolve) => {
        finishStalkTransition = resolve;
      });
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "sleep_drift_full_preview" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        PET_MODE_DRIFT_SLEEP_PREVIEW_SETTLE_MS
        + PET_MODE_DRIFT_SLEEP_NOTICE_MS
        + PET_MODE_DRIFT_SLEEP_FULL_PREVIEW_HOLD_MS
        + PET_MODE_DRIFT_SLEEP_WAKE_MS,
      );
    });

    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("is-sleep-wake")).toBe(true);
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(true);
    expect(cat.classList.contains("has-hunt-alert")).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_HUNT_ALERT_MS);
    });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("has-hunt-alert")).toBe(false);

    await act(async () => { finishStalkTransition(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("stalk");
    expect(cat.classList.contains("has-sleep-drift-expression")).toBe(false);
    expect(cat.classList.contains("has-hunt-alert")).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_HUNT_ALERT_MS - 1); });
    expect(cat.classList.contains("has-hunt-alert")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(cat.classList.contains("has-hunt-alert")).toBe(false);
  });

  it("starts the complete drift preview when the Lab cat is already asleep", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "sleep" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("sleep");

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "sleep_drift_full_preview" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_SLEEP_PREVIEW_SETTLE_MS); });

    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("is-sleep-notice")).toBe(true);
  });

  it("defers a due hunt while the context menu owns the cat", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY, "true");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let closeMenu!: () => void;
    bridge.openNativePetModeMenu.mockImplementationOnce(() => new Promise((resolve) => {
      closeMenu = () => resolve(true);
    }));
    bridge.stalkNativePetCursor.mockImplementationOnce(() => new Promise(() => undefined));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    fireEvent.contextMenu(screen.getByLabelText("Pet Drifty cat. Drag to move. Right-click for options."));
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();

    await act(async () => { closeMenu(); await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.stalkNativePetCursor).toHaveBeenCalledTimes(1);
  });

  it("does not replay a stale hunt after explicit hide and re-enable", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY, "true");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    const hiddenUntil = Date.now() + 60_000;
    window.localStorage.setItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY, String(hiddenUntil));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_HIDDEN_UNTIL_STORAGE_KEY,
        newValue: String(hiddenUntil),
      }));
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();

    window.localStorage.removeItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_HIDDEN_UNTIL_STORAGE_KEY,
        newValue: null,
      }));
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS + 1 },
      });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
  });

  it("enters a natural outing from the cursor display edge before stalking", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY, "true");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.stalkNativePetCursor.mockImplementationOnce(() => new Promise(() => undefined));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_PRESENT_MS + 5_000);
      await Promise.resolve();
    });

    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);
    expect(bridge.setNativePetPresence).toHaveBeenCalledWith(false, 1);
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_NOTICE_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.prepareNativePetOutingHunt).not.toHaveBeenCalled();
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).not.toBe("notice");

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.prepareNativePetOutingHunt).toHaveBeenCalledWith({ side: "left", generation: 1 });
    expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();
    expect(bridge.prepareNativePetOutingHunt.mock.invocationCallOrder[0])
      .toBeLessThan(bridge.stalkNativePetCursor.mock.invocationCallOrder[0]);
    expect(bridge.stalkNativePetCursor).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("stalk");
  });

  // This fake-timer recovery case exceeded Vitest's 5s default in two CI runs;
  // each timeout was followed by cascading empty-DOM failures in later cases.
  it("recovers at home if a natural-outing hunt cannot prepare its edge entry", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY, "true");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.prepareNativePetOutingHunt.mockResolvedValueOnce(null);

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_PRESENT_MS + 5_000);
      await Promise.resolve();
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.setNativePetPresence).toHaveBeenLastCalledWith(true);
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  }, 15_000);

  it("keeps native cursor control inert while the production drift reaction stays active", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("stalk");
    expect(screen.getByLabelText("Drifty pet cat").classList.contains("has-hunt-alert")).toBe(true);
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
    expect(bridge.returnWithNativePetCursor).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_STALK_SETTLE_MS); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "cursor_hunt_single" }));
    await act(async () => { await Promise.resolve(); });
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
  });

  it("clears the passive drift alert as soon as focus returns", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_STALK_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("stalk");
    expect(cat.classList.contains("has-hunt-alert")).toBe(true);

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 1 },
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(cat.getAttribute("data-phase")).toBe("sit");
    expect(cat.classList.contains("has-hunt-alert")).toBe(false);
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
    expect(bridge.returnWithNativePetCursor).not.toHaveBeenCalled();
  });

  it("runs the same native cursor hunt path from the enabled Dev preview", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem("drifty.pet.driftHuntEnabled.v1", "true");
    window.localStorage.setItem("drifty.pet.driftHuntAlertCue.v1", "false");
    window.localStorage.setItem(PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY, "4500");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 120 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "cursor_hunt_chase" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(bridge.stalkNativePetCursor).toHaveBeenCalledWith({
      ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
      enabled: true,
      mode: "chase",
      chaseDurationMs: 4_500,
      softTurns: true,
      showAlertCue: false,
    });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("bite");
    expect(cat.classList.contains("has-hunt-alert")).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_CURSOR_BITE_HOLD_MS); });
    expect(bridge.returnWithNativePetCursor).toHaveBeenCalledWith({
      targetX: 640,
      targetY: 320,
      approachFacing: "right",
      cursorMovementDistance: 0,
      settings: {
        ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
        enabled: true,
        mode: "chase",
        chaseDurationMs: 4_500,
        showAlertCue: false,
      },
    });
  });

  it("hard-stops an active cursor hunt when Dev mode turns off", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY, "true");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishStalk: (() => void) | null = null;
    bridge.stalkNativePetCursor.mockImplementationOnce(() => new Promise((resolve) => {
      finishStalk = () => resolve({
        outcome: "completed",
        facing: "right",
        cursorX: 640,
        cursorY: 320,
        cursorMovementDistance: 0,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "cursor_hunt_chase" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("stalk");

    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: DEV_MODE_STORAGE_KEY,
        newValue: "0",
      }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(bridge.cancelNativePetMotion).toHaveBeenCalled();
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
    act(() => finishStalk?.());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.returnWithNativePetCursor).not.toHaveBeenCalled();
  });

  it("opens its own menu on right-click and routes each choice natively", async () => {
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    /* The pet is a transparent always-on-top panel. If WebKit's own context
       menu survives, the user gets Reload/Inspect floating over their desktop
       instead of the pet's options, so suppressing it is part of the feature. */
    const menuEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    const notPrevented = pet.dispatchEvent(menuEvent);
    expect(notPrevented, "the browser's own context menu must not survive").toBe(false);
    await act(async () => undefined);

    expect(bridge.openNativePetModeMenu).toHaveBeenCalledTimes(1);
    // A right-click is a menu request, so it must never register as petting.
    expect(bridge.beginNativePetDrag).not.toHaveBeenCalled();

    const actions = bridge.openNativePetModeMenu.mock.calls[0][0];

    actions.onHideForOneHour();
    expect(bridge.triggerNativePetVisibilityAction).toHaveBeenCalledWith("hideOneHour");

    actions.onTurnOffPet();
    expect(bridge.triggerNativePetVisibilityAction).toHaveBeenCalledWith("turnOff");

    actions.onOpenDashboard();
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("openDashboard");

    actions.onOpenSettings();
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("openSettings");

  });

  it("stays away on a restart that lands inside a temporary hide", async () => {
    /* The pet window mounts from storage, so reading only the enabled flag
       would replay the entry walk for a cat the user hid minutes ago. */
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY, String(Date.now() + 60_000));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const cat = document.querySelector(".pet-mode-cat");
    expect(cat?.getAttribute("data-phase")).not.toBe("entry");
  });

  it("holds the cat still while its menu is open and never stacks two", async () => {
    /* The menu is anchored where the cat stands. Autonomous life running
       underneath it would walk the cat out from under its own menu. */
    let releaseMenu: (() => void) | null = null;
    bridge.openNativePetModeMenu.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { releaseMenu = () => resolve(true); }),
    );
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    fireEvent.contextMenu(pet);
    await act(async () => undefined);
    expect(bridge.openNativePetModeMenu).toHaveBeenCalledTimes(1);

    // A second right-click while the first menu is still up must not stack.
    fireEvent.contextMenu(pet);
    await act(async () => undefined);
    expect(bridge.openNativePetModeMenu).toHaveBeenCalledTimes(1);

    await act(async () => { releaseMenu?.(); });

    // Once the menu closes the pet accepts a menu request again.
    fireEvent.contextMenu(pet);
    await act(async () => undefined);
    expect(bridge.openNativePetModeMenu).toHaveBeenCalledTimes(2);
  });

  it("holds autonomous motion while the quick-controls native menu is open", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => undefined);

    expect(bridge.quickControlsMenuStateHandler).not.toBeNull();
    act(() => bridge.quickControlsMenuStateHandler?.(true));
    bridge.roamNativePet.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_LIFE_ACTION_INTERVAL_MS);
    });
    expect(bridge.roamNativePet).not.toHaveBeenCalled();
  });

  it("does not open its menu while the cat is being dragged", async () => {
    /* AppKit owns the pointer for the whole drag. Popping a menu mid-carry
       would steal that press and drop the cat somewhere the user never chose,
       so a right-click during a drag is swallowed rather than answered. */
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise(() => {}));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 1, clientX: 60, clientY: 50 });
    await act(async () => undefined);

    fireEvent.contextMenu(pet);
    await act(async () => undefined);

    expect(bridge.openNativePetModeMenu).not.toHaveBeenCalled();
  });

  it("hides quick controls as soon as play or dragging begins", async () => {
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise(() => {}));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    bridge.setNativePetQuickControlsVisible.mockClear();

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 51, clientX: 60, clientY: 50 });

    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenCalledWith(false);
  });

  it("resumes a stationary hover after the drag cooldown", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.sampleNativePetCursor.mockResolvedValue({
      cursorX: 620,
      cursorY: 330,
      windowX: 560,
      windowY: 280,
      windowWidth: 144,
      windowHeight: 99,
      visible: true,
    });
    bridge.isNativePetCursorInside.mockResolvedValue(true);
    bridge.beginNativePetDrag.mockResolvedValueOnce({
      moved: true,
      startX: 620,
      startY: 330,
      endX: 700,
      endY: 360,
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_QUICK_CONTROLS_HOVER_OPEN_MS + PET_QUICK_CONTROLS_POLL_MS * 2);
    });
    expect(bridge.setNativePetQuickControlsVisible).not.toHaveBeenCalledWith(true);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 53, clientX: 60, clientY: 50 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    bridge.setNativePetQuickControlsVisible.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_QUICK_CONTROLS_INTERACTION_COOLDOWN_MS - 1);
    });
    expect(bridge.setNativePetQuickControlsVisible).not.toHaveBeenCalledWith(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_QUICK_CONTROLS_HOVER_OPEN_MS + PET_QUICK_CONTROLS_POLL_MS * 2);
    });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenCalledWith(true);
  });

  it("does not reopen quick controls when play starts during an in-flight hover sample", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    const finishSamples: Array<(sample: {
      cursorX: number;
      cursorY: number;
      windowX: number;
      windowY: number;
      windowWidth: number;
      windowHeight: number;
      visible: boolean;
    }) => void> = [];
    bridge.sampleNativePetCursor.mockImplementation(() => new Promise((resolve) => {
      finishSamples.push(resolve);
    }));
    bridge.isNativePetCursorInside.mockResolvedValue(true);
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise(() => {}));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(finishSamples.length).toBeGreaterThan(0);
    bridge.setNativePetQuickControlsVisible.mockClear();

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 52, clientX: 60, clientY: 50 });
    await act(async () => {
      finishSamples.forEach((finish) => finish({
        cursorX: 620,
        cursorY: 330,
        windowX: 560,
        windowY: 280,
        windowWidth: 144,
        windowHeight: 99,
        visible: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenCalledWith(false);
    expect(bridge.setNativePetQuickControlsVisible.mock.calls.some(([visible]) => visible)).toBe(false);
  });

  it("boots as a transparent pet surface and supports direct dragging", async () => {
    vi.useFakeTimers();
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    expect(document.documentElement.dataset.surface).toBe("pet-mode");
    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(pet, "pointermove", { pointerId: 1, clientX: 20, clientY: 10 });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.beginNativePetDrag).toHaveBeenCalledTimes(1);
    expect(bridge.beginNativePetDrag).toHaveBeenCalledWith(10, 10, PET_MODE_DRAG_PICKUP_MS);
  });

  it("applies native facing updates before movement so the cat never walks backward", async () => {
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "facing", facing: "left" });
    });

    expect(screen.getByLabelText("Drifty pet cat").classList.contains("is-mirrored")).toBe(true);
  });

  it("applies the facing preview only from Dev mode while the pet is resting", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    bridge.stagePetModeHitRegionTransition.mockClear();

    act(() => {
      bridge.eventHandler?.({ kind: "preview_facing", facing: "left" });
    });
    expect(screen.getByLabelText("Drifty pet cat").classList.contains("is-mirrored")).toBe(false);
    expect(bridge.stagePetModeHitRegionTransition).not.toHaveBeenCalled();

    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    await act(async () => {
      bridge.eventHandler?.({ kind: "preview_facing", facing: "left" });
      await Promise.resolve();
    });

    expect(bridge.stagePetModeHitRegionTransition).toHaveBeenCalledWith({
      regionId: "transition:facing:left",
      mirrored: true,
    });
    expect(screen.getByLabelText("Drifty pet cat").classList.contains("is-mirrored")).toBe(true);
    expect(bridge.reportNativePetModeLabState).toHaveBeenCalledWith(expect.objectContaining({
      facing: "left",
    }));
  });

  it("does not paint a new facing until native has closed the previous hit region", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    let releaseStage: (() => void) | null = null;
    bridge.stagePetModeHitRegionTransition.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseStage = resolve;
    }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "facing", facing: "left" });
    });
    expect(bridge.stagePetModeHitRegionTransition).toHaveBeenCalledWith({
      regionId: "transition:facing:left",
      mirrored: true,
    });
    expect(screen.getByLabelText("Drifty pet cat").classList.contains("is-mirrored")).toBe(false);

    await act(async () => {
      releaseStage?.();
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Drifty pet cat").classList.contains("is-mirrored")).toBe(true);
  });

  it("keeps the rendered facing when native cannot close the prior hit region", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.stagePetModeHitRegionTransition.mockRejectedValueOnce(new Error("native unavailable"));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    await act(async () => {
      bridge.eventHandler?.({ kind: "facing", facing: "left" });
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Drifty pet cat").classList.contains("is-mirrored")).toBe(false);

    await act(async () => {
      bridge.eventHandler?.({ kind: "facing", facing: "left" });
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Drifty pet cat").classList.contains("is-mirrored")).toBe(true);
  });

  it("closes the old native silhouette before painting the entry pose", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    let releaseStage: (() => void) | null = null;
    bridge.stagePetModeHitRegionTransition.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseStage = resolve;
    }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    await act(async () => {
      bridge.eventHandler?.({ kind: "motion", motion: "entry" });
      await Promise.resolve();
    });
    expect(bridge.stagePetModeHitRegionTransition).toHaveBeenCalledWith({
      regionId: "transition:entry",
      mirrored: false,
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");

    await act(async () => {
      releaseStage?.();
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("entry");
  });

  it("keeps input closed until overlapping pose and facing transitions both settle", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_RUN_BETA_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const releases: Array<() => void> = [];
    bridge.stagePetModeHitRegionTransition.mockImplementation(() => new Promise<void>((resolve) => {
      releases.push(resolve);
    }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "facing", facing: "left" });
      bridge.eventHandler?.({ kind: "motion", motion: "run" });
    });
    expect(releases).toHaveLength(2);

    await act(async () => {
      releases[1]?.();
      await Promise.resolve();
    });
    const publishCallsWhilePending = bridge.publishPetModeHitRegion.mock.calls;
    expect(publishCallsWhilePending[publishCallsWhilePending.length - 1]?.[0]).toMatchObject({
      regionId: "run-gait:0",
      interactive: false,
    });

    await act(async () => {
      releases[0]?.();
      await Promise.resolve();
    });
    const publishCallsAfterSettled = bridge.publishPetModeHitRegion.mock.calls;
    expect(publishCallsAfterSettled[publishCallsAfterSettled.length - 1]?.[0]).toMatchObject({
      regionId: "run-gait:0",
      mirrored: true,
      interactive: true,
    });
  });

  it("switches between the default vector run and beta raster run on storage updates", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames: walkFrames, cycleSeconds: 1 }),
    }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => bridge.eventHandler?.({ kind: "motion", motion: "run" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-region-id")).toBe("gait:0");

    await act(async () => {
      window.localStorage.setItem(PET_MODE_RUN_BETA_STORAGE_KEY, "1");
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_RUN_BETA_STORAGE_KEY,
        newValue: "1",
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-region-id")).toBe("run-gait:0");

    act(() => {
      window.localStorage.setItem(PET_MODE_RUN_BETA_STORAGE_KEY, "0");
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_RUN_BETA_STORAGE_KEY,
        newValue: "0",
      }));
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-region-id")).toBe("gait:0");
  });

  it("holds the exact rendered entry SVG when native reports landing", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ frames: walkFrames, cycleSeconds: 1.25 }),
    }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      bridge.eventHandler?.({ kind: "facing", facing: "left" });
      bridge.eventHandler?.({ kind: "motion", motion: "entry" });
      await Promise.resolve();
    });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("entry");
    expect(cat.classList.contains("is-mirrored")).toBe(true);
    expect(cat.style.getPropertyValue("--pet-entry-duration")).toBe(`${PET_MODE_ENTRY_DURATION_MS}ms`);
    expect(cat.style.getPropertyValue("--pet-gait-baseline-shift")).toBe(`${PET_MODE_GAIT_BASELINE_SHIFT_PX}px`);
    expect(cat.style.getPropertyValue("--pet-gait-center-shift")).toBe(`${PET_MODE_GAIT_CENTER_SHIFT_PX}px`);
    const entryVector = cat.querySelector(".pet-mode-cat__vector");
    const entryPath = entryVector?.querySelector("path")?.getAttribute("d");

    await act(async () => {
      bridge.eventHandler?.({ kind: "entry_complete" });
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(cat.classList.contains("is-entry-landed")).toBe(true);
    const landedVector = cat.querySelector(".pet-mode-cat__landed-vector");
    expect(landedVector).toBe(entryVector);
    expect(landedVector?.querySelector("path")?.getAttribute("d")).toBe(entryPath);
    expect(cat.querySelector(".pet-mode-cat__motion > .pet-mode-cat__raster")).toBeNull();
  });

  it("uses native travel distance for the short run entrance", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ frames: walkFrames, cycleSeconds: 1.25 }),
    }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      bridge.eventHandler?.({ kind: "facing", facing: "left" });
      bridge.eventHandler?.({ kind: "motion", motion: "entry", travelDistance: 90, durationMs: 300 });
      await Promise.resolve();
    });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("entry");
    expect(cat.style.getPropertyValue("--pet-entry-duration")).toBe("300ms");
  });

  it("does not swap the landed raster when walk frames load after entry completion", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    let resolveFetch: ((response: { json: () => Promise<{ frames: readonly string[]; cycleSeconds: number }> }) => void) | null = null;
    let resolvePayload: ((payload: { frames: readonly string[]; cycleSeconds: number }) => void) | null = null;
    const fetchPromise = new Promise<{ json: () => Promise<{ frames: readonly string[]; cycleSeconds: number }> }>((resolve) => {
      resolveFetch = resolve;
    });
    const payloadPromise = new Promise<{ frames: readonly string[]; cycleSeconds: number }>((resolve) => {
      resolvePayload = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(fetchPromise));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    await act(async () => {
      bridge.eventHandler?.({ kind: "motion", motion: "entry" });
      bridge.eventHandler?.({ kind: "entry_complete" });
      await Promise.resolve();
    });
    const cat = screen.getByLabelText("Drifty pet cat");
    const landedRaster = cat.querySelector(".pet-mode-cat__motion > .pet-mode-cat__raster");
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(cat.classList.contains("is-entry-landed")).toBe(false);
    expect(landedRaster).not.toBeNull();

    await act(async () => {
      resolveFetch?.({ json: () => payloadPromise });
      await fetchPromise;
      resolvePayload?.({ frames: walkFrames, cycleSeconds: 1.25 });
      await payloadPromise;
    });

    expect(cat.querySelector(".pet-mode-cat__landed-vector")).toBeNull();
    expect(cat.querySelector(".pet-mode-cat__motion > .pet-mode-cat__raster")).toBe(landedRaster);

    // Prove the payload has reached component state, rather than allowing the
    // idle assertion above to pass while the promise chain is still pending.
    await act(async () => {
      bridge.eventHandler?.({ kind: "motion", motion: "entry" });
      await Promise.resolve();
    });
    expect(cat.querySelector(".pet-mode-cat__vector")).not.toBeNull();
  });

  it("starts fresh autonomous clocks only after a newly shown pet has landed", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    // The renderer stays mounted behind the hidden native panel. Time spent
    // with Show Pet off must not age either autonomous scheduler.
    await act(async () => { await vi.advanceTimersByTimeAsync(13 * 60 * 1000); });
    expect(bridge.exitNativePetScreen).not.toHaveBeenCalled();
    expect(bridge.roamNativePet).not.toHaveBeenCalled();

    // Native normally cancels this event when the toggle turns off. The
    // renderer must still reject a previously queued completion on its side.
    act(() => {
      bridge.eventHandler?.({ kind: "entry_complete" });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_PRESENT_MS + 5_000); });
    expect(bridge.exitNativePetScreen).not.toHaveBeenCalled();
    expect(bridge.roamNativePet).not.toHaveBeenCalled();

    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_STORAGE_KEY }));
      bridge.eventHandler?.({ kind: "motion", motion: "entry" });
      bridge.eventHandler?.({ kind: "entry_complete" });
    });
    await act(async () => undefined);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_PRESENT_MS - 1); });
    expect(bridge.exitNativePetScreen).not.toHaveBeenCalled();
    expect(bridge.roamNativePet).not.toHaveBeenCalled();

    // A blink or tail flick that already owns the exact due frame may defer the
    // outing to its existing one-second interruptibility retry.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);
  });

  it("keeps autonomous and diagnostic outings disabled until the preference is re-enabled", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_OUTING_PREFERENCE_STORAGE_KEY, "0");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_PRESENT_MS + 5_000); });
    expect(bridge.exitNativePetScreen).not.toHaveBeenCalled();

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "outing" }));
    await act(async () => { await Promise.resolve(); });
    expect(bridge.exitNativePetScreen).not.toHaveBeenCalled();

    window.localStorage.setItem(PET_OUTING_PREFERENCE_STORAGE_KEY, "1");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_OUTING_PREFERENCE_STORAGE_KEY,
        oldValue: "0",
        newValue: "1",
      }));
    });
    await act(async () => undefined);
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_PRESENT_MS + 5_000); });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);
  });

  it("cancels an exit in flight through a rapid Off-On pair and reveals the resident pet", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishExit!: (ticket: PetModeOutingTicket) => void;
    bridge.exitNativePetScreen.mockImplementationOnce(() => new Promise((resolve) => {
      finishExit = resolve;
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "outing" }));
    await act(async () => { await Promise.resolve(); });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);

    window.localStorage.setItem(PET_OUTING_PREFERENCE_STORAGE_KEY, "1");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_OUTING_PREFERENCE_STORAGE_KEY,
        oldValue: "1",
        newValue: "0",
      }));
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_OUTING_PREFERENCE_STORAGE_KEY,
        oldValue: "0",
        newValue: "1",
      }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.cancelNativePetMotion).toHaveBeenCalled();
    expect(bridge.setNativePetPresence).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");

    await act(async () => {
      finishExit({ side: "left", generation: 9 });
      await Promise.resolve();
    });
    expect(bridge.setNativePetPresence.mock.calls.some(([visible]) => visible === false)).toBe(false);
    expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();
  });

  it("does not let deferred outing recovery overwrite a newer action", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishExit!: (ticket: PetModeOutingTicket) => void;
    bridge.exitNativePetScreen.mockImplementationOnce(() => new Promise((resolve) => {
      finishExit = resolve;
    }));
    let finishCancellation!: () => void;
    bridge.cancelNativePetMotion.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishCancellation = resolve;
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "outing" }));
    await act(async () => { await Promise.resolve(); });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_OUTING_PREFERENCE_STORAGE_KEY,
        oldValue: null,
        newValue: "0",
      }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.cancelNativePetMotion).toHaveBeenCalledTimes(1);

    act(() => bridge.eventHandler?.({
      kind: "motion",
      motion: "entry",
      travelDistance: 180,
      durationMs: 900,
    }));
    await act(async () => { await Promise.resolve(); });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("entry");

    await act(async () => { finishCancellation(); await Promise.resolve(); });
    expect(bridge.setNativePetPresence).not.toHaveBeenCalledWith(true);
    expect(cat.getAttribute("data-phase")).toBe("entry");

    await act(async () => {
      finishExit({ side: "left", generation: 11 });
      await Promise.resolve();
    });
    expect(bridge.setNativePetPresence.mock.calls.some(([visible]) => visible === false)).toBe(false);
    expect(cat.getAttribute("data-phase")).toBe("entry");
  });

  it("does not reveal an explicit Off that wins a race with an active outing opt-out", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "outing" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.setNativePetPresence).toHaveBeenCalledWith(false, 1);

    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "0");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_OUTING_PREFERENCE_STORAGE_KEY,
        oldValue: null,
        newValue: "0",
      }));
    });
    await act(async () => undefined);
    expect(bridge.cancelNativePetMotion).toHaveBeenCalled();
    expect(bridge.setNativePetPresence).not.toHaveBeenCalledWith(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });
    expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();
  });

  it("does not reveal a temporary manual hide that wins while outing cancellation is in flight", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishCancellation!: () => void;
    bridge.cancelNativePetMotion.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishCancellation = resolve;
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "outing" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.setNativePetPresence).toHaveBeenCalledWith(false, 1);

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_OUTING_PREFERENCE_STORAGE_KEY,
        oldValue: null,
        newValue: "0",
      }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.cancelNativePetMotion).toHaveBeenCalled();

    const hiddenUntil = Date.now() + 60_000;
    window.localStorage.setItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY, String(hiddenUntil));
    act(() => {
      // The manual hide wins while the outing cancellation command is still
      // in flight. Its later completion must not reopen the native panel.
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_HIDDEN_UNTIL_STORAGE_KEY,
        oldValue: null,
        newValue: String(hiddenUntil),
      }));
    });
    await act(async () => { finishCancellation(); await Promise.resolve(); });
    expect(bridge.setNativePetPresence).not.toHaveBeenCalledWith(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });
    expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();
  });

  it("cancels an in-flight outing from queued Off and On event snapshots", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishExit!: (ticket: PetModeOutingTicket) => void;
    bridge.exitNativePetScreen.mockImplementationOnce(() => new Promise((resolve) => {
      finishExit = resolve;
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    await act(async () => {
      bridge.eventHandler?.({ kind: "preview_action", action: "outing" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);

    // Both events can be queued behind a final persisted `true`. Their payloads,
    // not a later localStorage read, are the authoritative transition snapshots.
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_STORAGE_KEY,
        oldValue: "1",
        newValue: "0",
      }));
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_STORAGE_KEY,
        oldValue: "0",
        newValue: "1",
      }));
    });
    await act(async () => {
      finishExit({ side: "left", generation: 7 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.setNativePetPresence.mock.calls.some(([visible]) => visible === false)).toBe(false);
    expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();
  });

  it("uses the same native ticket to hide and return from a normal outing", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    await act(async () => {
      bridge.eventHandler?.({ kind: "preview_action", action: "outing" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.setNativePetPresence).toHaveBeenCalledWith(false, 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });
    expect(bridge.returnNativePetFromOuting).toHaveBeenCalledWith({
      side: "left",
      generation: 1,
    });
  });

  it("cancels a return in flight and settles the pet visibly at home when outings turn off", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishReturn!: () => void;
    bridge.returnNativePetFromOuting.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishReturn = resolve;
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "outing" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });
    expect(bridge.returnNativePetFromOuting).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_OUTING_PREFERENCE_STORAGE_KEY,
        oldValue: null,
        newValue: "0",
      }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(bridge.cancelNativePetMotion).toHaveBeenCalled();
    expect(bridge.setNativePetPresence).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
    await act(async () => { finishReturn(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("lets force reveal cancel an in-flight Dev outing return", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    await act(async () => {
      bridge.eventHandler?.({ kind: "preview_action", action: "outing" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);
    expect(bridge.setNativePetPresence).toHaveBeenCalledWith(false, 1);

    act(() => {
      bridge.eventHandler?.({ kind: "reveal" });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });

    expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();
  });

  it("ignores a queued reveal after a newer Off request wins", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "0");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_STORAGE_KEY,
        oldValue: "1",
        newValue: "0",
      }));
      bridge.eventHandler?.({ kind: "reveal" });
    });

    await act(async () => undefined);
    const publishCalls = bridge.publishPetModeHitRegion.mock.calls;
    const latestPublish = publishCalls[publishCalls.length - 1]?.[0];
    expect(latestPublish).toMatchObject({ interactive: false });
  });

  it("uses the shipped 4-minute standing cadence for autonomous life actions", async () => {
    vi.useFakeTimers();
    // 0.7 keeps the independent tail-flick timer quiet, chooses `sit`, and
    // applies a deterministic 1.112 cadence multiplier.
    vi.spyOn(Math, "random").mockReturnValue(0.7);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_LIFE_ACTION_INTERVAL_MS * 1.112 - 1);
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");
  });

  it("does not synthesize a cold-start entry pose when reduced motion is requested", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    bridge.listenToNativePetModeEvent.mockResolvedValue(vi.fn());

    render(<PetModeWindowApp />);
    await act(async () => undefined);

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("recovers a persisted cold-start entry if the native completion event was missed", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    bridge.listenToNativePetModeEvent.mockResolvedValue(vi.fn());

    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("entry");
    expect(screen.getByRole("button").classList.contains("is-entering")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(PET_MODE_ENTRY_DURATION_MS + PET_MODE_ENTRY_FALLBACK_GRACE_MS);
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(screen.getByRole("button").classList.contains("is-entering")).toBe(false);
    expect(bridge.setNativePetPresence).toHaveBeenCalledWith(true);
  });

  it("restarts the fallback deadline when native begins a newer entry", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => { vi.advanceTimersByTime(800); });
    act(() => {
      bridge.eventHandler?.({ kind: "motion", motion: "entry" });
    });
    act(() => { vi.advanceTimersByTime(121); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("entry");

    await act(async () => {
      vi.advanceTimersByTime(PET_MODE_ENTRY_DURATION_MS + PET_MODE_ENTRY_FALLBACK_GRACE_MS);
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("runs detailed Pet Mode Lab actions through the real pet state machine", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stretch" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("stretch");
    expect(bridge.reportNativePetModeLabState).toHaveBeenCalledWith(expect.objectContaining({
      phase: "stretch",
      activeAction: "stretch",
    }));

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_LIFE_MOTION_DURATION_MS); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sit" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "wake" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "music_note" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").classList.contains("has-music-note")).toBe(true);
    expect(bridge.reportNativePetModeLabState).toHaveBeenCalledWith(expect.objectContaining({
      phase: "idle",
      activeAction: "music_note",
    }));

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stop" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").classList.contains("has-music-note")).toBe(false);

    // A cleared timer must not resurrect the accent after Stop.
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_MUSIC_NOTE_DURATION_MS); });
    expect(screen.getByLabelText("Drifty pet cat").classList.contains("has-music-note")).toBe(false);
  });

  it("runs deterministic expressive scenarios without changing the probability override", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stretch_with_note" });
    });
    await act(async () => { await Promise.resolve(); });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("stretch");
    expect(cat.classList.contains("has-music-note")).toBe(true);
    expect(bridge.reportNativePetModeLabState).toHaveBeenCalledWith(expect.objectContaining({
      phase: "stretch",
      activeAction: "stretch_with_note",
    }));

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_LIFE_MOTION_DURATION_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(cat.classList.contains("has-music-note")).toBe(false);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "tail_flick_with_note" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("tail");
    expect(cat.classList.contains("has-music-note")).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_TAIL_FLICK_DURATION_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sleep_angry_wake" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(cat.getAttribute("data-phase")).toBe("anger");
    expect(document.querySelector(".pet-mode-cat__anger")).not.toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("keeps deterministic expressive scenarios behind Dev mode", async () => {
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stretch_with_note" });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(cat.classList.contains("has-music-note")).toBe(false);
  });

  it("forces music notes for relaxed motions only when guaranteed outcomes is enabled", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY, "1");
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stretch" });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("stretch");
    expect(cat.classList.contains("has-music-note")).toBe(true);
  });

  it("shows the music note for only the first 760 ms of a qualifying relaxed motion", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stretch" });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("stretch");
    expect(cat.classList.contains("has-music-note")).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_MUSIC_NOTE_DURATION_MS); });
    expect(cat.classList.contains("has-music-note")).toBe(false);
    expect(cat.getAttribute("data-phase")).toBe("stretch");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_LIFE_MOTION_DURATION_MS - PET_MODE_MUSIC_NOTE_DURATION_MS);
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("keeps production music-note odds active while the manual preview stays Dev-only", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    const random = vi.spyOn(Math, "random").mockReturnValue(0.01);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    const callsBeforeAction = random.mock.calls.length;

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stretch" });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("stretch");
    expect(cat.classList.contains("has-music-note")).toBe(true);
    expect(random.mock.calls.length).toBeGreaterThan(callsBeforeAction);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_MUSIC_NOTE_DURATION_MS); });
    expect(cat.classList.contains("has-music-note")).toBe(false);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "music_note" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.classList.contains("has-music-note")).toBe(false);
  });

  it("lets a visible music note finish naturally when Dev mode turns off", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "music_note" });
    });
    await act(async () => { await Promise.resolve(); });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.classList.contains("has-music-note")).toBe(true);

    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: DEV_MODE_STORAGE_KEY,
        newValue: "0",
      }));
    });
    expect(cat.classList.contains("has-music-note")).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_MUSIC_NOTE_DURATION_MS); });
    expect(cat.classList.contains("has-music-note")).toBe(false);
  });

  it("uses the selected full Tail V2-B asset for the complete tail action", async () => {
    vi.useFakeTimers();
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "tail_flick" });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("tail");
    expect(cat.querySelector("img")?.getAttribute("src")).toBe("/pet-mode/life-motion/tail/f001.png");

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_TAIL_FLICK_DURATION_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("keeps the blink pose mounted through its complete close and reopen pass", async () => {
    vi.useFakeTimers();
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "blink" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("blink");

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_BLINK_DURATION_MS - 1); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("blink");

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("keeps Lab preview actions single-flight while native walking is still in progress", async () => {
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishWalk: (() => void) | null = null;
    bridge.roamNativePet.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishWalk = resolve;
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "walk" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("walk");

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stretch" });
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("walk");

    await act(async () => { finishWalk?.(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("runs the Lab life loop at a reviewable QA cadence and Stop cancels it", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "life_loop" });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(360); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("stretch");

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stop" });
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("replays the approved F12 v1.6 frames and reports contact only on frame 15", async () => {
    vi.useFakeTimers();
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drift-1",
          appName: "Google Chrome",
          browserName: "Google Chrome",
          preview: false,
        },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.moveNativePetToTarget).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(14 * 8 + 4); });
    expect(bridge.alignNativePetContact).toHaveBeenCalledWith(expect.objectContaining({
      targetX: 640,
      targetY: 48,
      diagnostic: "ax_selected_tab_close",
    }));
    expect(bridge.reportNativePetContact).toHaveBeenCalledTimes(1);
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("drift-1");
  });

  it("never reports paw contact when native target travel was cancelled", async () => {
    vi.useFakeTimers();
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.moveNativePetToTarget.mockResolvedValueOnce({
      facing: "right",
      targetKind: "browser_tab_close",
      confidence: "high",
      diagnostic: "ax_selected_tab_close",
      targetX: 640,
      targetY: 48,
      motionOutcome: "cancelled",
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drift-cancelled-travel",
          appName: "Aside",
          browserName: "Aside",
          preview: false,
        },
      });
    });
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(240);
    });

    expect(bridge.alignNativePetContact).not.toHaveBeenCalled();
    expect(bridge.reportNativePetContact).toHaveBeenCalledTimes(1);
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith(
      "drift-cancelled-travel",
      false,
      "native_motion_cancelled",
    );
    expect(bridge.reportNativePetContact).not.toHaveBeenCalledWith("drift-cancelled-travel");
  });

  it("skips pretend paw choreography when native X geometry is unavailable", async () => {
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.moveNativePetToTarget.mockResolvedValueOnce({
      facing: "right",
      targetKind: "fallback",
      motionOutcome: "not_attempted",
      confidence: "low",
      diagnostic: "accessibility_target_unavailable",
      targetX: 1400,
      targetY: 44,
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drift-without-geometry",
          appName: "Google Chrome",
          browserName: "Google Chrome",
          preview: false,
        },
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(bridge.reportNativePetContact).toHaveBeenCalledTimes(1);
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("drift-without-geometry", false, "target_unavailable");
    expect(bridge.returnNativePetHome).not.toHaveBeenCalled();
  });

  it("reports native movement failures as technical rejections instead of user catches", async () => {
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.moveNativePetToTarget.mockRejectedValueOnce(new Error("No monitor is available"));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drift-native-failure",
          appName: "Google Chrome",
          browserName: "Google Chrome",
          preview: false,
        },
      });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.reportNativePetContact).toHaveBeenCalledTimes(1);
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith(
      "drift-native-failure",
      false,
      "renderer_intervention_failed",
    );
  });

  it("does not fake a paw contact for Browser X when exact AX geometry is unavailable", async () => {
    vi.useFakeTimers();
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.moveNativePetToTarget.mockResolvedValueOnce({
      facing: "right",
      targetKind: "fallback",
      motionOutcome: "not_attempted",
      confidence: "low",
      diagnostic: "accessibility_target_unavailable",
      targetX: 1400,
      targetY: 44,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "browser-x-fallback",
          appName: "Aside",
          browserName: "Aside",
          preview: false,
          labTarget: "browser_tab_x",
        },
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("browser-x-fallback", false, "target_unavailable");
  });

  it("returns home even when the native contact signal fails", async () => {
    vi.useFakeTimers();
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.reportNativePetContact.mockRejectedValueOnce(new Error("contact unavailable"));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drift-contact-failure",
          appName: "Google Chrome",
          browserName: "Google Chrome",
          preview: true,
        },
      });
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(240); });

    expect(bridge.returnNativePetHome).toHaveBeenCalledTimes(1);
  });

  it("lets native movement distinguish a cat tap from a real panel drag", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 3, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 3, clientX: 12, clientY: 12 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.beginNativePetDrag).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("happy");
    expect(bridge.reportNativePetModeLabState).not.toHaveBeenCalledWith(expect.objectContaining({
      phase: "drag",
    }));

    bridge.beginNativePetDrag.mockResolvedValueOnce({
      moved: true,
      startX: 120,
      startY: 80,
      endX: 240,
      endY: 140,
    });
    dispatchPointer(pet, "pointerdown", { pointerId: 4, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointermove", { pointerId: 4, clientX: 24, clientY: 12 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    expect(bridge.beginNativePetDrag).toHaveBeenCalledTimes(2);
  });

  it("does not treat a relocating drag as a petting stroke", async () => {
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    bridge.beginNativePetDrag.mockResolvedValueOnce({
      moved: true,
      strokeDetected: false,
      startX: 120,
      startY: 80,
      endX: 240,
      endY: 140,
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 41, clientX: 12, clientY: 12 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).not.toBe("sleep");
    expect(bridge.rememberNativePetPosition).toHaveBeenCalled();
  });

  it("cancels a pickup flash when native later recognizes a stroke", async () => {
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: false,
        strokeDetected: true,
        startX: 120,
        startY: 80,
        endX: 120,
        endY: 80,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 42, clientX: 12, clientY: 12 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("drag");

    await act(async () => { bridge.strokeDetectedHandler?.(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).not.toBe("drag");

    await act(async () => { completeNativeDrag(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("happy");
  });

  it("turns a tap during motion into petting without flashing the held pose", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({ kind: "motion", motion: "run" });
    });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 31, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 31, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("happy");
    expect(bridge.reportNativePetModeLabState).not.toHaveBeenCalledWith(expect.objectContaining({
      phase: "drag",
    }));
  });

  it("preserves the sleeping cat's two-tap wake behavior", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sleep" });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 32, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 32, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sleep");

    dispatchPointer(pet, "pointerdown", { pointerId: 33, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 33, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("can show a brief anger mark only when the second sleep touch wakes the cat", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    vi.spyOn(Math, "random").mockReturnValue(0);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sleep" });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 34, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 34, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sleep");

    dispatchPointer(pet, "pointerdown", { pointerId: 35, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 35, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("anger");
    expect(document.querySelector(".pet-mode-cat__anger")).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS);
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("absorbs rapid extra taps before the angry wake reaction paints and until it finishes", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.spyOn(Math, "random").mockReturnValue(0);
    let finishAngerTransition!: () => void;
    bridge.stagePetModeHitRegionTransition.mockImplementation(async ({ regionId }) => {
      if (regionId !== "transition:anger") return;
      await new Promise<void>((resolve) => {
        finishAngerTransition = resolve;
      });
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sleep" });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 41, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 41, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    dispatchPointer(pet, "pointerdown", { pointerId: 42, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 42, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // The logical phase changes synchronously, but native hit-region staging
    // can delay the visible React commit. This is the exact pre-paint window in
    // which a rapid third tap previously cancelled anger and produced a heart.
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(bridge.beginNativePetDrag).toHaveBeenCalledTimes(2);

    dispatchPointer(pet, "pointerdown", { pointerId: 43, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 43, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerdown", { pointerId: 44, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 44, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(bridge.beginNativePetDrag).toHaveBeenCalledTimes(2);
    expect(cat.getAttribute("data-phase")).toBe("sleep");

    await act(async () => {
      finishAngerTransition();
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("anger");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_SLEEP_WAKE_ANGER_DURATION_MS);
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");

    dispatchPointer(pet, "pointerdown", { pointerId: 45, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 45, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("happy");
  });

  it("guarantees the angry wake reaction when guaranteed outcomes is enabled", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY, "1");
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sleep" });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 37, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 37, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    dispatchPointer(pet, "pointerdown", { pointerId: 38, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 38, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("anger");
    expect(document.querySelector(".pet-mode-cat__anger")).not.toBeNull();
  });

  it("ignores persisted guaranteed outcomes when Dev mode is off", async () => {
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    window.localStorage.setItem(PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY, "1");
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sleep" });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 39, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 39, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    dispatchPointer(pet, "pointerdown", { pointerId: 40, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 40, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
    expect(document.querySelector(".pet-mode-cat--anger")).toBeNull();
  });

  it("never shows the anger mark for awake petting even when the random roll qualifies", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 36, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 36, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("happy");
    expect(document.querySelector(".pet-mode-cat--anger")).toBeNull();
  });

  it("lands a focused hop on four paws, then sits", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 42 },
      });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("sit");

    dispatchPointer(pet, "pointerdown", { pointerId: 34, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("drag");
    expect(cat.getAttribute("data-region-id")).toBe("drag:sit:d-lifted-tail-live");
    expect(cat.querySelector(".pet-mode-cat__drag-pending-rest .pet-mode-cat__sit-pose")).toBeTruthy();
    expect(cat.querySelector('.pet-mode-cat__drag-pending-rest img[src="/pet-mode/paw/f001.png"]')).toBeNull();

    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("release");
    expect(cat.getAttribute("data-region-id")).toBe("release:idle");

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("sit");
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledWith(false);
    expect(bridge.roamNativePet).not.toHaveBeenCalled();
    expect(bridge.sampleNativePetCursor).not.toHaveBeenCalled();
  });

  it("stays on four paws until a focused AX corrective walk begins", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    let completeSeatCorrection!: () => void;
    bridge.rememberNativePetPosition.mockImplementationOnce(() => new Promise((resolve) => {
      completeSeatCorrection = () => resolve({
        x: 84,
        y: 14,
        moved: true,
        reason: "control_overlap",
      });
    }));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 42 },
      });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 48, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS);
      await Promise.resolve();
    });

    expect(bridge.rememberNativePetPosition).toHaveBeenCalledWith(false);
    expect(cat.getAttribute("data-phase")).toBe("idle");

    await act(async () => {
      bridge.eventHandler?.({
        kind: "motion",
        motion: "walk",
        purpose: "seat_correction",
      });
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("walk");

    await act(async () => {
      completeSeatCorrection();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("sit");
  });

  it("does not sit when focus starts during the final frames of an unsafe landing", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    let completeSeatCorrection!: () => void;
    bridge.rememberNativePetPosition.mockImplementationOnce(() => new Promise((resolve) => {
      completeSeatCorrection = () => resolve({
        x: 84,
        y: 14,
        moved: true,
        reason: "control_overlap",
      });
    }));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 49, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });

    // The mocked native drop lasts 16ms, leaving a 48ms final landing window.
    // Enter that window before focus begins so this covers the previous race.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS - 60);
    });
    expect(cat.getAttribute("data-phase")).toBe("release");
    expect(cat.getAttribute("data-region-id")).toBe("release:idle");

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 1 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-region-id")).toBe("release:idle");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
      await Promise.resolve();
    });
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledWith(false);
    expect(cat.getAttribute("data-phase")).toBe("idle");

    await act(async () => {
      bridge.eventHandler?.({
        kind: "motion",
        motion: "walk",
        purpose: "seat_correction",
      });
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("walk");

    await act(async () => {
      completeSeatCorrection();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("sit");
  });

  it("uses the 30 percent manual-drop walk even when Dev mode is off", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.7);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 40, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS);
      await Promise.resolve();
    });
    expect(bridge.roamNativePet).toHaveBeenCalledWith(true);
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("uses an AX corrective walk as the complete post-drop reaction", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.7);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.rememberNativePetPosition.mockResolvedValueOnce({
      x: 84,
      y: 14,
      moved: true,
      reason: "control_overlap",
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 47, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS);
      await Promise.resolve();
    });

    expect(bridge.rememberNativePetPosition).toHaveBeenCalledWith(false);
    expect(bridge.roamNativePet).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("uses the 30 percent manual-drop branch for a short same-level walk", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.7);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 41, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(cat.getAttribute("data-region-id")).toBe("release:idle");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS);
      await Promise.resolve();
    });
    expect(bridge.roamNativePet).toHaveBeenCalledWith(true);
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("uses the 10 percent manual-drop acknowledgement during focus, then sits again", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.95);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.sampleNativePetCursor.mockResolvedValueOnce({
      cursorX: 610,
      cursorY: 330,
      windowX: 640,
      windowY: 300,
      windowWidth: 144,
      windowHeight: 99,
      visible: true,
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 42 },
      });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 42, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(cat.getAttribute("data-region-id")).toBe("release:idle");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS);
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("notice");
    expect(cat.classList.contains("is-mirrored")).toBe(true);
    expect(cat.classList.contains("is-quiet-notice")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_POST_DROP_LOOK_DURATION_MS);
    });
    expect(cat.getAttribute("data-phase")).toBe("tail");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_TAIL_FLICK_DURATION_MS);
    });
    expect(cat.getAttribute("data-phase")).toBe("sit");
  });

  it("retargets an in-flight release when focus starts without interrupting the drop", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 35, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("release");
    expect(cat.getAttribute("data-region-id")).toBe("release:idle");
    const cancellationCount = bridge.cancelNativePetMotion.mock.calls.length;

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 1 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("release");
    expect(cat.getAttribute("data-region-id")).toBe("release:idle");
    expect(bridge.cancelNativePetMotion).toHaveBeenCalledTimes(cancellationCount);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("sit");
  });

  it("retargets an in-flight focused release when focus ends without interrupting the drop", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 42 },
      });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 36, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("release");
    expect(cat.getAttribute("data-region-id")).toBe("release:idle");
    const cancellationCount = bridge.cancelNativePetMotion.mock.calls.length;

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "neutral", contextLabel: "editor", durationSeconds: 1 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("release");
    expect(cat.getAttribute("data-region-id")).toBe("release:idle");
    expect(cat.querySelector('.pet-mode-cat__release-rest img[src="/pet-mode/paw/f001.png"]')).toBeTruthy();
    expect(bridge.cancelNativePetMotion).toHaveBeenCalledTimes(cancellationCount);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("uses an immediate held-to-sit handoff for focused reduced-motion drags", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 42 },
      });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 37, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    expect(bridge.beginNativePetDrag).toHaveBeenCalledWith(18, 18, 0);
    expect(cat.getAttribute("data-region-id")).toBe("drag:sit:d-lifted-tail-live");

    await act(async () => { completeNativeDrag(); await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sit");
    expect(bridge.resolveNativePetDrop).not.toHaveBeenCalled();
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);
  });

  it("lets focus take over after an explicit stop cancels an in-flight release", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 38, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("release");

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "stop" }));
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("idle");

    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 1 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sit");
  });

  it("lets a drag take over from native movement without clicking through to the dashboard", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    let phaseAtNativeCommandStart: string | null = null;
    let assetAtNativeCommandStart: string | null = null;
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => {
      const catAtNativeHandoff = screen.getByLabelText("Drifty pet cat");
      phaseAtNativeCommandStart = catAtNativeHandoff.getAttribute("data-phase");
      assetAtNativeCommandStart = catAtNativeHandoff
        .querySelector(".pet-mode-cat__drag-pending-held")
        ?.getAttribute("src") ?? null;
      return new Promise((resolve) => {
        completeNativeDrag = () => resolve({
          moved: true,
          startX: 120,
          startY: 80,
          endX: 240,
          endY: 140,
        });
      });
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({ kind: "motion", motion: "run" });
    });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const press = dispatchPointer(pet, "pointerdown", { pointerId: 8, clientX: 18, clientY: 18 });
    dispatchPointer(pet, "pointermove", { pointerId: 8, clientX: 30, clientY: 18 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    expect(press.defaultPrevented).toBe(true);
    expect(bridge.reportNativePetPointer).toHaveBeenCalledTimes(1);
    expect(bridge.cancelNativePetMotion).toHaveBeenCalledTimes(1);
    expect(bridge.beginNativePetDrag).toHaveBeenCalledTimes(1);
    expect(bridge.beginNativePetDrag).toHaveBeenCalledWith(18, 18, PET_MODE_DRAG_PICKUP_MS);
    expect(phaseAtNativeCommandStart).toBe("run");
    expect(assetAtNativeCommandStart).toBeNull();
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("run");

    act(() => {
      bridge.dragStartHandler?.();
    });
    expect(cat.getAttribute("data-phase")).toBe("drag");
    expect(cat.querySelector(".pet-mode-cat__drag-pending-held")?.getAttribute("src")).toBe("/pet-mode/drag/scruff-b.png?v=gpt-image-20260805");

    dispatchPointer(pet, "pointerup", { pointerId: 8, clientX: 30, clientY: 18 });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("release");

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);

  });

  it("keeps manual drag authoritative over a running life action and stale native motion", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stretch" });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("stretch");

    let completeLifeActionDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeLifeActionDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 240,
        endY: 140,
      });
    }));
    dispatchPointer(pet, "pointerdown", { pointerId: 9, clientX: 18, clientY: 18 });
    dispatchPointer(pet, "pointermove", { pointerId: 9, clientX: 30, clientY: 18 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    act(() => {
      bridge.dragStartHandler?.();
    });
    expect(cat.getAttribute("data-phase")).toBe("drag");

    act(() => {
      bridge.eventHandler?.({ kind: "motion", motion: "walk" });
    });
    expect(cat.getAttribute("data-phase")).toBe("drag");

    dispatchPointer(pet, "pointerup", { pointerId: 9, clientX: 30, clientY: 18 });
    await act(async () => { completeLifeActionDrag(); await Promise.resolve(); });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_LIFE_MOTION_DURATION_MS + PET_MODE_DRAG_SETTLE_MS);
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("always completes a moved native drag even when another action invalidates its token", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 240,
        endY: 140,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 10, clientX: 18, clientY: 18 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    act(() => {
      bridge.dragStartHandler?.();
    });
    expect(cat.getAttribute("data-phase")).toBe("drag");

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stop" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("idle");

    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("release");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("starts release from the native drag-end event before the invoke promise settles", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    bridge.listenToNativePetModeEvent.mockResolvedValue(vi.fn());
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise(() => undefined));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 11, clientX: 18, clientY: 18 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    act(() => {
      bridge.dragStartHandler?.();
    });
    expect(cat.getAttribute("data-phase")).toBe("drag");

    act(() => {
      bridge.dragEndHandler?.({ moved: true, startX: 120, startY: 80, endX: 180, endY: 96 });
    });
    expect(cat.getAttribute("data-phase")).toBe("release");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);
  });

  it("forces the floor drop when a shake is detected", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockResolvedValue(vi.fn());
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise(() => undefined));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 12, clientX: 18, clientY: 18 });
    act(() => bridge.dragStartHandler?.());
    act(() => {
      bridge.dragEndHandler?.({
        moved: true,
        shakeDetected: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    });

    expect(bridge.resolveNativePetDrop).toHaveBeenCalledWith(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
  });

  it("still forces the floor drop when Dev mode is off", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockResolvedValue(vi.fn());
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise(() => undefined));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 13, clientX: 18, clientY: 18 });
    act(() => bridge.dragStartHandler?.());
    act(() => {
      bridge.dragEndHandler?.({
        moved: true,
        shakeDetected: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    });

    expect(bridge.resolveNativePetDrop).toHaveBeenCalledWith(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
  });

  it("does not animate or force a shake drop when reduced motion is requested", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockResolvedValue(vi.fn());
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise(() => undefined));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 14, clientX: 18, clientY: 18 });
    act(() => bridge.dragStartHandler?.());
    act(() => {
      bridge.dragEndHandler?.({
        moved: true,
        shakeDetected: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(bridge.resolveNativePetDrop).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("keeps the shipped settle when drop resolution hops", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    bridge.listenToNativePetModeEvent.mockResolvedValue(vi.fn());
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 21, clientX: 18, clientY: 18 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    act(() => { bridge.dragStartHandler?.(); });
    expect(cat.getAttribute("data-phase")).toBe("drag");
    dispatchPointer(pet, "pointerup", { pointerId: 21, clientX: 40, clientY: 18 });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(bridge.resolveNativePetDrop).toHaveBeenCalledWith(false);
    expect(cat.getAttribute("data-phase")).toBe("release");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("waits for a catch drop before returning to idle", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    bridge.listenToNativePetModeEvent.mockResolvedValue(vi.fn());
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    let finishDrop!: (value: { kind: string; distance: number; durationMs: number; targetY: number; ledge: string }) => void;
    bridge.resolveNativePetDrop.mockImplementationOnce(() => new Promise((resolve) => {
      finishDrop = resolve;
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 22, clientX: 18, clientY: 18 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    act(() => { bridge.dragStartHandler?.(); });
    dispatchPointer(pet, "pointerup", { pointerId: 22, clientX: 40, clientY: 18 });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("release");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("release");
    await act(async () => {
      finishDrop({ kind: "catch", distance: 80, durationMs: 180, targetY: 220, ledge: "Safari" });
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("keeps a long focused catch standing until native landing finishes", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        startX: 120,
        startY: 80,
        endX: 180,
        endY: 96,
      });
    }));
    let finishDrop!: (value: { kind: string; distance: number; durationMs: number; targetY: number; ledge: string }) => void;
    bridge.resolveNativePetDrop.mockImplementationOnce(() => new Promise((resolve) => {
      finishDrop = resolve;
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 42 },
      });
    });
    await act(async () => { await Promise.resolve(); });

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 43, clientX: 18, clientY: 18 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(cat.getAttribute("data-region-id")).toBe("release:idle");

    await act(async () => {
      finishDrop({ kind: "catch", distance: 420, durationMs: 520, targetY: 700, ledge: "floor" });
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sit");
  });

  it("publishes the committed silhouette instead of owning the full native rectangle", async () => {
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => { await Promise.resolve(); });

    expect(bridge.publishPetModeHitRegion).toHaveBeenCalledWith(expect.objectContaining({
      regionId: "idle",
      mirrored: false,
      interactive: false,
    }));
  });

  it("keeps the live drop preview badge off unless Dev guide lines are on", async () => {
    vi.useFakeTimers();
    let probeHandler: ((probe: any) => void) | null = null;
    let guidesHandler: ((event: { kind: "guides"; enabled: boolean }) => void) | null = null;
    bridge.listenToNativePetDragProbe.mockImplementationOnce(async (handler) => {
      probeHandler = handler;
      return vi.fn();
    });
    bridge.listenToNativePetModeEvent.mockImplementationOnce(async (handler) => {
      guidesHandler = handler;
      return vi.fn();
    });
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise(() => undefined));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 23, clientX: 18, clientY: 18 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    act(() => { bridge.dragStartHandler?.(); });

    act(() => {
      probeHandler?.({ kind: "catch", distance: 52, durationMs: 140, targetY: 210, ledge: "Safari" });
    });
    expect(screen.queryByText("낙하: Safari (52pt)")).toBeNull();
    expect(bridge.probeNativePetAxSeat).not.toHaveBeenCalled();

    await act(async () => {
      guidesHandler?.({ kind: "guides", enabled: true });
      probeHandler?.({ kind: "catch", distance: 52, durationMs: 140, targetY: 210, ledge: "Safari" });
      await Promise.resolve();
    });
    expect(screen.getByText("낙하: Safari (52pt)")).toBeDefined();
    expect(screen.getByText("AX FREE")).toBeDefined();
    expect(bridge.probeNativePetAxSeat).toHaveBeenCalledTimes(1);

    bridge.probeNativePetAxSeat.mockResolvedValueOnce({
      x: 172,
      y: 80,
      moved: true,
      reason: "control_overlap",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      probeHandler?.({ kind: "stay_top", distance: 0, durationMs: 0, targetY: 40, ledge: "menubar" });
      await Promise.resolve();
    });
    expect(screen.getByText("상단 집 (안 떨어짐)")).toBeDefined();
    expect(screen.getByText("BUTTON OVERLAP")).toBeDefined();

    await act(async () => {
      probeHandler?.({ kind: "hop", distance: 4, durationMs: 29, targetY: 300, ledge: "hop" });
      await Promise.resolve();
    });
    expect(screen.getByText("일반 낙하 (4pt 홉)")).toBeDefined();

    act(() => guidesHandler?.({ kind: "guides", enabled: false }));
    expect(screen.queryByText("AX FREE")).toBeNull();
    expect(screen.queryByText("BUTTON OVERLAP")).toBeNull();
    vi.useRealTimers();
  });

  it("keeps the live AX drag probe single-flight and surfaces an unknown result", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_GUIDES_STORAGE_KEY, "1");
    let probeHandler: ((probe: any) => void) | null = null;
    let finishProbe!: (value: {
      x: number;
      y: number;
      moved: boolean;
      reason: "accessibility_unavailable";
    }) => void;
    bridge.listenToNativePetDragProbe.mockImplementationOnce(async (handler) => {
      probeHandler = handler;
      return vi.fn();
    });
    bridge.probeNativePetAxSeat.mockImplementationOnce(() => new Promise((resolve) => {
      finishProbe = resolve;
    }));
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise(() => undefined));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 24, clientX: 18, clientY: 18 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    act(() => { bridge.dragStartHandler?.(); });

    act(() => {
      probeHandler?.({ kind: "hop", distance: 4, durationMs: 29, targetY: 300, ledge: "hop" });
      probeHandler?.({ kind: "hop", distance: 4, durationMs: 29, targetY: 300, ledge: "hop" });
    });
    expect(bridge.probeNativePetAxSeat).toHaveBeenCalledTimes(1);
    expect(screen.getByText("AX SCANNING")).toBeDefined();

    await act(async () => {
      finishProbe({
        x: 120,
        y: 80,
        moved: false,
        reason: "accessibility_unavailable",
      });
      await Promise.resolve();
    });
    expect(screen.getByText("AX UNKNOWN")).toBeDefined();

    let finishRefresh!: (value: {
      x: number;
      y: number;
      moved: boolean;
      reason: "no_control_overlap";
    }) => void;
    bridge.probeNativePetAxSeat.mockImplementationOnce(() => new Promise((resolve) => {
      finishRefresh = resolve;
    }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      probeHandler?.({ kind: "hop", distance: 4, durationMs: 29, targetY: 300, ledge: "hop" });
    });
    expect(bridge.probeNativePetAxSeat).toHaveBeenCalledTimes(2);
    expect(screen.getByText("AX UNKNOWN")).toBeDefined();
    expect(screen.queryByText("AX SCANNING")).toBeNull();

    await act(async () => {
      finishRefresh({
        x: 120,
        y: 80,
        moved: false,
        reason: "no_control_overlap",
      });
      await Promise.resolve();
    });
    expect(screen.getByText("AX FREE")).toBeDefined();
    vi.useRealTimers();
  });
});
