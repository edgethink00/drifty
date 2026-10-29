// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, buildAutomaticCloseOverride } from "../companion/automaticCloseOverride";
import { PET_QUICK_CONTROLS_PREFERENCE_STORAGE_KEY, persistPetQuickControlsPreference } from "./petQuickControlsPreference";
import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";
import { PetModeWindowApp, formatTargetUnavailableReason } from "./PetModeWindowApp";
import { getPetModeRenderSize } from "./petModeRenderGeometry";
import type { PetModeNativeDragResult } from "./petModeBridge";
import {
  PET_MODE_BLINK_DURATION_MS,
  PET_MODE_DRAG_PICKUP_MS,
  PET_MODE_DRAG_SETTLE_MS,
  PET_MODE_ENTRY_DURATION_MS,
  PET_MODE_ENTRY_MAX_DURATION_MS,
  PET_MODE_ENTRY_FALLBACK_GRACE_MS,
  PET_MODE_GAIT_BASELINE_SHIFT_PX,
  PET_MODE_GAIT_CENTER_SHIFT_PX,
  PET_MODE_LIFE_MOTION_DURATION_MS,
  PET_MODE_DANCE_DURATION_MS,
  PET_MODE_DANCE_ON_CLOSE_BETA_STORAGE_KEY,
  PET_MODE_MUSIC_NOTE_DURATION_MS,
  PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY,
  PET_MODE_GUIDES_STORAGE_KEY,
  PET_MODE_INTERVENTION_PAW_LEAD_MS,
  PET_MODE_PRESENT_MS,
  PET_MODE_POST_DROP_LOOK_DURATION_MS,
  PET_MODE_FAST_RUN_STORAGE_KEY,
  PET_MODE_SIZE_STORAGE_KEY,
  PET_MODE_SEAT_CLEAR_CONFIRM_MS,
  PET_MODE_DROWSY_RESETTLE_MS,
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
import {
  PET_PRESENCE_MODE_STORAGE_KEY,
  PET_TURN_OFF_SUGGESTION_SEEN_STORAGE_KEY,
} from "./petPresenceMode";

const walkFrames = (JSON.parse(
  readFileSync("public/pet-mode/walk-frames-v2.json", "utf8"),
) as { readonly frames: readonly string[] }).frames;

// These long-clock cases exercise thousands of 80ms native-control polls.
// Keep their full simulated duration and async ordering; the wall-clock budget
// is a harness deadline, not an assertion about the pet's response latency.
const LONG_CLOCK_TEST_TIMEOUT_MS = 20_000;

function dispatchPointer(
  target: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { readonly button?: number; readonly pointerId: number; readonly clientX: number; readonly clientY: number; readonly pointerType?: string },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: init.button ?? 0 },
    pointerId: { value: init.pointerId },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    pointerType: { value: init.pointerType },
  });
  fireEvent(target, event);
  return event;
}

const bridge = vi.hoisted(() => ({
  contactInvoke: vi.fn().mockResolvedValue(null),
  contactListen: vi.fn(),
  isTauri: vi.fn().mockReturnValue(false),
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
  manualRequestSequence: 0,
  createPetManualDragRequestId: vi.fn(() => `0000000000001-${String(++bridge.manualRequestSequence).padStart(6, "0")}`),
  setNativePetDanceHeadroom: vi.fn().mockResolvedValue(true),
  dragEndHandler: null as ((result: {
    moved: boolean;
    shakeDetected?: boolean;
    strokeDetected?: boolean;
    manualRequestId?: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  }) => void) | null,
  dragStartHandler: null as ((manualRequestId?: string) => void) | null,
  strokeDetectedHandler: null as ((manualRequestId?: string) => void) | null,
  dragProbeHandler: null as ((probe: import("./petModeBridge").PetDropPlan | null, manualRequestId?: string) => void) | null,
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
  listenToNativePetDragProbe: vi.fn().mockImplementation(async (handler) => {
    bridge.dragProbeHandler = handler;
    return vi.fn();
  }),
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
  quickControlsHoldHandler: null as ((held: boolean, generation: number) => void) | null,
  listenToNativePetQuickControlsHold: vi.fn().mockImplementation(async (handler) => {
    bridge.quickControlsHoldHandler = handler;
    return vi.fn();
  }),
  quickControlsMenuStateHandler: null as ((open: boolean) => void) | null,
  listenToNativePetQuickControlsAction: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetQuickControlsMenuState: vi.fn().mockImplementation(async (handler) => {
    bridge.quickControlsMenuStateHandler = handler;
    return vi.fn();
  }),
  setNativePetQuickControlsVisible: vi.fn().mockImplementation(async (visible: boolean) => visible),
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

vi.mock("./petModeBridge", () => ({
  alignNativePetContact: bridge.alignNativePetContact,
  beginNativePetDrag: bridge.beginNativePetDrag,
  cancelNativePetMotion: bridge.cancelNativePetMotion,
  createPetManualDragRequestId: bridge.createPetManualDragRequestId,
  setNativePetDanceHeadroom: bridge.setNativePetDanceHeadroom,
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
  listenToNativePetQuickControlsHold: bridge.listenToNativePetQuickControlsHold,
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

vi.mock("./petModeHitRegions", () => ({
  preloadPetModeHitRegions: bridge.preloadPetModeHitRegions,
  stagePetModeHitRegionTransition: bridge.stagePetModeHitRegionTransition,
  publishPetModeHitRegion: bridge.publishPetModeHitRegion,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.contactInvoke, isTauri: bridge.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.contactListen, emit: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onMoved: bridge.onMoved }),
}));

// The authored paw beat (prep, lift, contact paint, return) lasts about one
// second, and the close scene keeps it even when the system asks for reduced
// motion. Advance past it before asserting what follows the close.
const PAW_SCENE_SETTLE_MS = 1_100;

describe("PetModeWindowApp", () => {
  async function renderResidentPet() {
    const view = render(<PetModeWindowApp />);
    await act(async () => undefined);
    // Model the main webview restoring Show Pet after the hidden renderer
    // mounts. A native pose preview/drag requires an enabled, landed pet.
    await act(async () => {
      window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
      window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_STORAGE_KEY, newValue: "1" }));
      bridge.eventHandler?.({ kind: "entry_complete" });
    });
    return view;
  }

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    if (vi.isMockFunction(Math.random)) vi.mocked(Math.random).mockRestore();
    vi.clearAllMocks();
    bridge.contactInvoke.mockReset().mockResolvedValue(null);
    bridge.contactListen.mockReset();
    bridge.isTauri.mockReset().mockReturnValue(false);
    bridge.reportNativePetContact.mockReset().mockResolvedValue(undefined);
    bridge.sampleNativePetCursor.mockReset().mockResolvedValue(null);
    bridge.isNativePetCursorInside.mockReset().mockResolvedValue(false);
    bridge.isNativePetQuickControlsCursorInside.mockReset().mockResolvedValue(false);
    bridge.setNativePetQuickControlsVisible.mockReset().mockImplementation(async (visible: boolean) => visible);
    bridge.stagePetModeHitRegionTransition.mockReset().mockResolvedValue(undefined);
    bridge.setNativePetDanceHeadroom.mockReset().mockResolvedValue(true);
    bridge.setNativePetPresence.mockReset().mockResolvedValue(undefined);
    bridge.beginNativePetDrag.mockReset().mockResolvedValue({ moved: false, startX: 120, startY: 80, endX: 120, endY: 80 });
    bridge.dragEndHandler = null;
    bridge.dragStartHandler = null;
    bridge.dragProbeHandler = null;
    bridge.strokeDetectedHandler = null;
    bridge.eventHandler = null;
    bridge.quickControlsHoldHandler = null;
    bridge.quickControlsMenuStateHandler = null;
    window.localStorage.clear();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.surface;
  });

  it("waits for the native viewport before painting a larger cat", async () => {
    vi.stubGlobal("innerWidth", Math.ceil(getPetModeRenderSize(100).width));
    vi.stubGlobal("innerHeight", Math.ceil(getPetModeRenderSize(100).height));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    expect(document.documentElement.style.getPropertyValue("--pet-size-scale")).toBe("1");

    // Settings storage reaches the pet webview before the Windows resize.
    act(() => {
      window.localStorage.setItem(PET_MODE_SIZE_STORAGE_KEY, "125");
      window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_SIZE_STORAGE_KEY }));
    });
    expect(document.documentElement.style.getPropertyValue("--pet-size-scale")).toBe("1");

    vi.stubGlobal("innerWidth", Math.ceil(getPetModeRenderSize(125).width));
    vi.stubGlobal("innerHeight", Math.ceil(getPetModeRenderSize(125).height));
    act(() => window.dispatchEvent(new Event("resize")));
    expect(document.documentElement.style.getPropertyValue("--pet-size-scale")).toBe("1.25");

    // A user-selected decrease can paint immediately before the panel shrinks.
    act(() => {
      window.localStorage.setItem(PET_MODE_SIZE_STORAGE_KEY, "100");
      window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_SIZE_STORAGE_KEY }));
    });
    expect(document.documentElement.style.getPropertyValue("--pet-size-scale")).toBe("1");
  });

  it("keeps the cat inside the viewport when native resize arrives before storage", async () => {
    window.localStorage.setItem(PET_MODE_SIZE_STORAGE_KEY, "125");
    vi.stubGlobal("innerWidth", Math.ceil(getPetModeRenderSize(125).width));
    vi.stubGlobal("innerHeight", Math.ceil(getPetModeRenderSize(125).height));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    expect(document.documentElement.style.getPropertyValue("--pet-size-scale")).toBe("1.25");

    // The native panel can shrink before this WebView receives the storage
    // event. The viewport itself must limit the painted size in that order.
    vi.stubGlobal("innerWidth", Math.ceil(getPetModeRenderSize(50).width));
    vi.stubGlobal("innerHeight", Math.ceil(getPetModeRenderSize(50).height));
    act(() => window.dispatchEvent(new Event("resize")));
    expect(document.documentElement.style.getPropertyValue("--pet-size-scale")).toBe("0.5");

    act(() => {
      window.localStorage.setItem(PET_MODE_SIZE_STORAGE_KEY, "50");
      window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_SIZE_STORAGE_KEY }));
    });
    expect(document.documentElement.style.getPropertyValue("--pet-size-scale")).toBe("0.5");

    // Growing the panel first leaves the existing smaller cat visible until
    // the requested size arrives; then the full-size panel can paint it.
    vi.stubGlobal("innerWidth", Math.ceil(getPetModeRenderSize(125).width));
    vi.stubGlobal("innerHeight", Math.ceil(getPetModeRenderSize(125).height));
    act(() => window.dispatchEvent(new Event("resize")));
    expect(document.documentElement.style.getPropertyValue("--pet-size-scale")).toBe("0.5");
    act(() => {
      window.localStorage.setItem(PET_MODE_SIZE_STORAGE_KEY, "125");
      window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_SIZE_STORAGE_KEY }));
    });
    expect(document.documentElement.style.getPropertyValue("--pet-size-scale")).toBe("1.25");
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
    // Keep "today" comfortably ahead of local midnight. Without a fixed
    // wall clock this suite becomes time-of-day dependent: a run during the
    // final 14 minutes of the day legitimately expires the pause while the
    // assertion below still expects it to remain asleep.
    vi.setSystemTime(new Date(2026, 8, 14, 12, 0, 0, 0));
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
    expect(bridge.beginNativePetDrag).toHaveBeenLastCalledWith(18, 18, 0, undefined, expect.any(String));
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

  it("holds the sleeping seat during a pause and returns home only after waking", async () => {
    const cat = await mountTimedPause();
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    await act(async () => bridge.eventHandler?.({
      kind: "snapshot",
      snapshot: { productivity: "neutral", contextLabel: "browser", durationSeconds: 1, surfaceRevision: 1 },
    }));
    await act(async () => bridge.eventHandler?.({
      kind: "snapshot",
      snapshot: { productivity: "neutral", contextLabel: "editor", durationSeconds: 1, surfaceRevision: 2 },
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    // Asleep, the cat may still step off a covered control, but it must not
    // wander back to its remembered home.
    expect(bridge.reconcileNativePetPosition).toHaveBeenLastCalledWith(false, true);
    bridge.reconcileNativePetPosition.mockClear();

    // Automatic deadline expiry is covered by the preceding test. Advance the
    // wall clock and use the foreground refresh here so this seat-policy check
    // does not batch 150 periodic native scans into the same fake-timer tick.
    await act(async () => {
      vi.setSystemTime(Date.now() + 15 * 60_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    // A phase-change effect normally schedules this within 120 ms. Under a
    // fully parallel suite React can defer that passive effect, so keep the
    // same product contract bounded by the 6-second periodic safety net.
    for (
      let elapsedMs = 0;
      elapsedMs <= PET_MODE_SEAT_RECONCILE_INTERVAL_MS + 120
        && !bridge.reconcileNativePetPosition.mock.calls.some(
          ([reducedMotion, onlyIfCoveringControl]) => !reducedMotion && !onlyIfCoveringControl,
        );
      elapsedMs += 120
    ) {
      await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    }
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledWith(false, false);
  }, 20_000);

  it("gets up and walks off a covered control with drowsy eyes, then lies back down while paused", async () => {
    const cat = await mountTimedPause();
    let arrive!: () => void;
    bridge.reconcileNativePetPosition.mockImplementationOnce(() => new Promise((resolve) => {
      arrive = () => resolve({ x: 900, y: 47, moved: true, reason: "control_overlap" });
    }));
    await act(async () => bridge.eventHandler?.({
      kind: "snapshot",
      snapshot: { productivity: "neutral", contextLabel: "browser", durationSeconds: 1, surfaceRevision: 1 },
    }));
    await act(async () => bridge.eventHandler?.({
      kind: "snapshot",
      snapshot: { productivity: "neutral", contextLabel: "editor", durationSeconds: 1, surfaceRevision: 2 },
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(bridge.reconcileNativePetPosition).toHaveBeenLastCalledWith(false, true);

    // Native announces the facing first, then the drowsy seat correction.
    const mirroredBefore = cat.classList.contains("is-mirrored");
    await act(async () => bridge.eventHandler?.({ kind: "facing", facing: mirroredBefore ? "right" : "left" }));
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    await act(async () => bridge.eventHandler?.({ kind: "motion", motion: "walk", purpose: "drowsy_seat_correction" }));
    // Up and walking in the same beat, eyes still heavy.
    expect(cat.getAttribute("data-phase")).toBe("walk");
    expect(cat.classList.contains("is-mirrored")).toBe(!mirroredBefore);
    // Walk frames do not load under jsdom; the drowsy walk face itself is
    // covered in petModeDrowsyWalkFace.test.tsx. Here the flag is enough.
    expect(cat.classList.contains("is-sleepwalking")).toBe(true);

    await act(async () => { arrive(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("drowsy");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DROWSY_RESETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("is-sleepwalking")).toBe(false);
  }, 20_000);

  it("ignores a plain seat correction while the timed pause keeps the cat asleep", async () => {
    const cat = await mountTimedPause();
    await act(async () => bridge.eventHandler?.({ kind: "motion", motion: "walk", purpose: "seat_correction" }));
    expect(cat.getAttribute("data-phase")).toBe("sleep");
  });

  async function beginPausedSleepwalk() {
    const cat = await mountTimedPause();
    let settle!: (resolution: { x: number; y: number; moved: boolean; reason: string }) => void;
    bridge.reconcileNativePetPosition.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    await act(async () => bridge.eventHandler?.({
      kind: "snapshot",
      snapshot: { productivity: "neutral", contextLabel: "browser", durationSeconds: 1, surfaceRevision: 1 },
    }));
    await act(async () => bridge.eventHandler?.({
      kind: "snapshot",
      snapshot: { productivity: "neutral", contextLabel: "editor", durationSeconds: 1, surfaceRevision: 2 },
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await act(async () => bridge.eventHandler?.({ kind: "motion", motion: "walk", purpose: "drowsy_seat_correction" }));
    expect(cat.getAttribute("data-phase")).toBe("walk");
    expect(cat.classList.contains("is-sleepwalking")).toBe(true);
    return { cat, settle: (resolution: { x: number; y: number; moved: boolean; reason: string }) => settle(resolution) };
  }

  it("lies back down when the sleepwalk is superseded under a timed pause", async () => {
    const { cat, settle } = await beginPausedSleepwalk();
    await act(async () => { settle({ x: 120, y: 80, moved: false, reason: "motion_superseded" }); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("is-sleepwalking")).toBe(false);
    // The sleep lock is back: nothing else can stand the cat up mid-pause.
    await act(async () => bridge.eventHandler?.({ kind: "motion", motion: "walk", purpose: "seat_correction" }));
    expect(cat.getAttribute("data-phase")).toBe("sleep");
  });

  it("keeps the sleeping pose when the user grabs a sleepwalking cat", async () => {
    const { cat } = await beginPausedSleepwalk();
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise(() => undefined));
    await act(async () => dispatchPointer(screen.getByRole("button", { name: /Pet Drifty cat/ }), "pointerdown", { pointerId: 82, clientX: 18, clientY: 18 }));
    expect(cat.classList.contains("is-sleepwalking")).toBe(false);
    await act(async () => bridge.dragStartHandler?.());
    expect(cat.getAttribute("data-phase")).toBe("sleep");
  });

  it("wakes upright when the pause ends mid-sleepwalk and stays awake once the walk resolves", async () => {
    const { cat, settle } = await beginPausedSleepwalk();
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(cat.classList.contains("is-sleepwalking")).toBe(false);
    // The old walk's answer arrives after the pause is over: an awake cat
    // must not lie back down because of it.
    await act(async () => { settle({ x: 900, y: 47, moved: true, reason: "control_overlap" }); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DROWSY_RESETTLE_MS + 50); });
    expect(cat.getAttribute("data-phase")).not.toBe("sleep");
  }, 20_000);

  it("drops a grabbed sleepwalker asleep, then wakes it normally when the pause ends", async () => {
    const { cat } = await beginPausedSleepwalk();
    const result = { moved: true, startX: 120, startY: 80, endX: 180, endY: 96 };
    let completeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise((resolve) => { completeDrag = () => resolve(result); }));
    await act(async () => dispatchPointer(screen.getByRole("button", { name: /Pet Drifty cat/ }), "pointerdown", { pointerId: 83, clientX: 18, clientY: 18 }));
    await act(async () => bridge.dragEndHandler?.(result));
    await act(async () => completeDrag());
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    expect(cat.classList.contains("is-sleepwalking")).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  }, 20_000);

  it("sleepwalks a naturally sleeping cat too and lets a later wake stand it up", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let arrive!: () => void;
    bridge.reconcileNativePetPosition.mockImplementationOnce(() => new Promise((resolve) => {
      arrive = () => resolve({ x: 900, y: 47, moved: true, reason: "control_overlap" });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "sleep" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("sleep");

    await act(async () => bridge.eventHandler?.({ kind: "snapshot", snapshot: { productivity: "neutral", contextLabel: "a", durationSeconds: 1, surfaceRevision: 1 } }));
    await act(async () => bridge.eventHandler?.({ kind: "snapshot", snapshot: { productivity: "neutral", contextLabel: "b", durationSeconds: 1, surfaceRevision: 2 } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    // A naturally sleeping cat holds its seat the same way.
    expect(bridge.reconcileNativePetPosition).toHaveBeenLastCalledWith(false, true);
    await act(async () => bridge.eventHandler?.({ kind: "motion", motion: "walk", purpose: "drowsy_seat_correction" }));
    expect(cat.getAttribute("data-phase")).toBe("walk");
    await act(async () => { arrive(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("drowsy");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DROWSY_RESETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("sleep");
    // Without a pause there is no lock: the usual wake still works.
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "wake" }));
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

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
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledWith(false, false);
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

    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledWith(false, false);
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
      await vi.advanceTimersByTimeAsync(PAW_SCENE_SETTLE_MS + 1_000);
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
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalledWith(false, false);
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
  }, LONG_CLOCK_TEST_TIMEOUT_MS);

  it("closes hover controls on opt-out, stays off outside Dev, and resumes after opt-in", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let cursorX = 600;
    bridge.sampleNativePetCursor.mockImplementation(async () => ({
      cursorX: (cursorX += 3), cursorY: 330,
      windowX: 560, windowY: 280, windowWidth: 144, windowHeight: 99, visible: true,
    }));
    bridge.isNativePetCursorInside.mockResolvedValue(true);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenCalledWith(true);

    bridge.setNativePetQuickControlsVisible.mockClear();
    // Model the Settings webview writing the preference while the bar is open.
    await act(async () => {
      window.localStorage.setItem(PET_QUICK_CONTROLS_PREFERENCE_STORAGE_KEY, "0");
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_QUICK_CONTROLS_PREFERENCE_STORAGE_KEY, newValue: "0",
      }));
    });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenCalledWith(false);
    bridge.setNativePetQuickControlsVisible.mockClear();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(bridge.setNativePetQuickControlsVisible).not.toHaveBeenCalledWith(true);

    cleanup();
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(bridge.setNativePetQuickControlsVisible).not.toHaveBeenCalledWith(true);

    await act(async () => { persistPetQuickControlsPreference(true); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenCalledWith(true);
  });

  it.each([false, true])("hides a native open that settles after opt-out (native hide deferred: %s)", async (deferredHide) => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let cursorX = 600;
    bridge.sampleNativePetCursor.mockImplementation(async () => ({
      cursorX: (cursorX += 3), cursorY: 330,
      windowX: 560, windowY: 280, windowWidth: 144, windowHeight: 99, visible: true,
    }));
    bridge.isNativePetCursorInside.mockResolvedValue(true);
    let finishOpen!: (visible: boolean) => void;
    let menuOpen = false;
    bridge.setNativePetQuickControlsVisible.mockImplementation((visible: boolean) => visible
      ? new Promise<boolean>((resolve) => { finishOpen = resolve; })
      : Promise.resolve(menuOpen));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(finishOpen).toBeTypeOf("function");
    await act(async () => { persistPetQuickControlsPreference(false); });
    bridge.setNativePetQuickControlsVisible.mockClear();
    menuOpen = deferredHide;
    await act(async () => { finishOpen(true); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenLastCalledWith(false);
    if (deferredHide) {
      bridge.setNativePetQuickControlsVisible.mockClear();
      await act(async () => { await vi.advanceTimersByTimeAsync(160); });
      expect(bridge.setNativePetQuickControlsVisible).toHaveBeenCalledWith(false);
      menuOpen = false;
      await act(async () => { await vi.advanceTimersByTimeAsync(80); });
      bridge.setNativePetQuickControlsVisible.mockClear();
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(bridge.setNativePetQuickControlsVisible).not.toHaveBeenCalled();
    }
  });

  it("retries opt-out hiding until a native menu releases the panel", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_QUICK_CONTROLS_PREFERENCE_STORAGE_KEY, "0");
    let menuOpen = true;
    bridge.setNativePetQuickControlsVisible.mockImplementation(async () => menuOpen);
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    bridge.setNativePetQuickControlsVisible.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenCalledWith(false);
    menuOpen = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    bridge.setNativePetQuickControlsVisible.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(bridge.setNativePetQuickControlsVisible).not.toHaveBeenCalled();
  });

  it("requires a fresh hover dwell after native denies opening controls", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let cursorX = 600;
    bridge.sampleNativePetCursor.mockImplementation(async () => ({
      cursorX: (cursorX += 3),
      cursorY: 330,
      windowX: 560,
      windowY: 280,
      windowWidth: 144,
      windowHeight: 99,
      visible: true,
    }));
    bridge.isNativePetCursorInside.mockResolvedValue(true);
    let denyOpen!: (visible: boolean) => void;
    let firstOpen = true;
    bridge.setNativePetQuickControlsVisible.mockImplementation(
      (visible: boolean) => {
        if (!visible) return Promise.resolve(false);
        if (!firstOpen) return Promise.resolve(true);
        firstOpen = false;
        return new Promise<boolean>((resolve) => {
          denyOpen = resolve;
        });
      },
    );
    bridge.listenToNativePetModeEvent.mockImplementation(
      async (handler: (event: PetModeWindowEvent) => void) => {
        bridge.eventHandler = handler;
        return vi.fn();
      },
    );
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    expect(
      bridge.setNativePetQuickControlsVisible.mock.calls.filter(
        ([visible]) => visible,
      ),
    ).toHaveLength(1);
    await act(async () => {
      denyOpen(false);
      await Promise.resolve();
    });
    expect(
      bridge.setNativePetQuickControlsVisible.mock.calls.filter(
        ([visible]) => visible,
      ),
    ).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(
      bridge.setNativePetQuickControlsVisible.mock.calls.filter(
        ([visible]) => visible,
      ),
    ).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(
      bridge.setNativePetQuickControlsVisible.mock.calls.filter(
        ([visible]) => visible,
      ),
    ).toHaveLength(2);
  });

  it("keeps native hold authoritative until its matching release generation", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(
      async (handler: (event: PetModeWindowEvent) => void) => {
        bridge.eventHandler = handler;
        return vi.fn();
      },
    );
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    bridge.reconcileNativePetPosition.mockClear();

    act(() => bridge.quickControlsHoldHandler?.(true, 7));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        PET_MODE_SEAT_RECONCILE_INTERVAL_MS + 200,
      );
    });
    expect(bridge.reconcileNativePetPosition).not.toHaveBeenCalled();

    act(() => bridge.quickControlsHoldHandler?.(false, 6));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        PET_MODE_SEAT_RECONCILE_INTERVAL_MS + 200,
      );
    });
    expect(bridge.reconcileNativePetPosition).not.toHaveBeenCalled();

    act(() => {
      bridge.quickControlsHoldHandler?.(false, 7);
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: {
          productivity: "focus",
          contextLabel: "editor",
          durationSeconds: 43,
          surfaceRevision: 1,
        },
      });
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: {
          productivity: "focus",
          contextLabel: "editor",
          durationSeconds: 44,
          surfaceRevision: 2,
        },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(bridge.reconcileNativePetPosition).toHaveBeenCalled();
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
      .mockImplementation(async (visible: boolean) => visible);
    bridge.isNativePetCursorInside.mockResolvedValue(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();
    });

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");
    expect(bridge.setNativePetQuickControlsVisible.mock.calls.filter(([visible]) => visible)).toHaveLength(2);
  });

  it.each([
    { label: "within one animation frame", responseDelay: 0, wait: 32 },
    { label: "when the native response crosses the exit deadline", responseDelay: 110, wait: 210 },
  ])("resumes a fading HUD $label", async ({ responseDelay, wait }) => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let cursorX = 600;
    bridge.sampleNativePetCursor.mockImplementation(async () => ({
      cursorX: cursorX += 3, cursorY: 330, windowX: 560, windowY: 280,
      windowWidth: 144, windowHeight: 99, visible: true,
    }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({ kind: "entry_complete" });
      bridge.eventHandler?.({ kind: "snapshot", snapshot: {
        productivity: "focus", contextLabel: "editor", durationSeconds: 42,
      } });
    });
    bridge.isNativePetCursorInside.mockResolvedValue(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(320); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenLastCalledWith(true);
    bridge.isNativePetCursorInside.mockResolvedValue(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(320); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenLastCalledWith(false);
    bridge.isNativePetQuickControlsCursorInside.mockImplementation(() =>
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(true), responseDelay)));
    bridge.setNativePetQuickControlsVisible.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(wait); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("samples the fading controls and reopens on the next poll without another dwell", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let cursorX = 600;
    bridge.sampleNativePetCursor.mockImplementation(async () => ({
      cursorX: cursorX += 3, cursorY: 330, windowX: 560, windowY: 280,
      windowWidth: 144, windowHeight: 99, visible: true,
    }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => {
      bridge.eventHandler?.({ kind: "entry_complete" });
      bridge.eventHandler?.({ kind: "snapshot", snapshot: {
        productivity: "focus", contextLabel: "editor", durationSeconds: 42,
      } });
    });
    bridge.isNativePetCursorInside.mockResolvedValue(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(320); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenLastCalledWith(true);
    bridge.isNativePetCursorInside.mockResolvedValue(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(320); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenLastCalledWith(false);
    bridge.isNativePetQuickControlsCursorInside.mockResolvedValue(true);
    bridge.setNativePetQuickControlsVisible.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenCalledExactlyOnceWith(true);
    bridge.isNativePetQuickControlsCursorInside.mockResolvedValue(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(320); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenLastCalledWith(false);
    act(() => bridge.quickControlsMenuStateHandler?.(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    bridge.setNativePetQuickControlsVisible.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(bridge.setNativePetQuickControlsVisible).not.toHaveBeenCalled();
    act(() => bridge.quickControlsMenuStateHandler?.(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(320); });
    expect(bridge.setNativePetQuickControlsVisible).toHaveBeenCalledExactlyOnceWith(false);
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
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");
    act(() => {
      bridge.eventHandler?.({
        kind: "motion",
        motion: "run",
        travelDistance: 152,
        durationMs: 533,
        startDelayMs: 34,
      });
    });
    await act(async () => { await Promise.resolve(); });
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
    act(() => {
      bridge.eventHandler?.({
        kind: "motion",
        motion: "run",
        travelDistance: 152,
        durationMs: 533,
        startDelayMs: 34,
      });
    });
    await act(async () => { await Promise.resolve(); });
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
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");
    act(() => {
      bridge.eventHandler?.({
        kind: "motion",
        motion: "run",
        travelDistance: 152,
        durationMs: 533,
        startDelayMs: 34,
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("run");
  });

  it.each([
    ["off", false],
    ["on", true],
  ])("starts paw preparation 150ms before the native run arrives (system reduced motion %s)", async (_label, reducedMotion) => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_FAST_RUN_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishMove!: () => void;
    bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise((resolve) => {
      finishMove = () => resolve({
        facing: "left",
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
          id: "settled-arrival",
          appName: "Google Chrome",
          browserName: "Google Chrome",
          preview: false,
        },
      });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    act(() => {
      bridge.eventHandler?.({
        kind: "motion",
        motion: "run",
        travelDistance: 152,
        durationMs: 533,
        startDelayMs: 34,
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("run");

    const pawLeadDelay = 34 + 533 - PET_MODE_INTERVENTION_PAW_LEAD_MS;
    await act(async () => { await vi.advanceTimersByTimeAsync(pawLeadDelay - 1); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("run");

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("paw");
    expect(cat.classList.contains("is-fast-run-paw-grounded")).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_INTERVENTION_PAW_LEAD_MS); });
    await act(async () => {
      finishMove();
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("paw");
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
      chaseDurationMs: 2_000,
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

  it("leaves the screen in drift-only presence, walks in for a sustained drift, and walks back out after focus holds", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, "drift_only");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    // The retreat waits for the entry to settle, then walks straight out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.resolve();
    });
    // The exit is the ordinary outing walk, hidden afterwards, with no return timer.
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);
    expect(bridge.setNativePetPresence).toHaveBeenCalledWith(false, 1);
    // Drift-only presence never schedules spontaneous outings or returns.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PET_MODE_PRESENT_MS + 5_000);
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);
    expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();

    // Focus does not drag the parked cat home just to sit.
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "code", durationSeconds: 30 },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();

    // An early notice is silent; the sustained stalk beat brings it in along
    // the outing return path (Cursor control is off, so no native pursuit).
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "drift", contextLabel: "video", durationSeconds: PET_MODE_DRIFT_NOTICE_SECONDS },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();
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
      await Promise.resolve();
    });
    expect(bridge.returnNativePetFromOuting).toHaveBeenCalledWith({ side: "left", generation: 1 });
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("stalk");

    // It stays for the whole episode, then leaves only after focus has held.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "code", durationSeconds: 5 },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      await Promise.resolve();
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(2);
    expect(bridge.setNativePetPresence).toHaveBeenLastCalledWith(false, 1);
  });

  it("brings the away cat home when presence returns to always", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, "drift_only");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.resolve();
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);

    act(() => {
      window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, "always");
      window.dispatchEvent(new StorageEvent("storage", { key: PET_PRESENCE_MODE_STORAGE_KEY, newValue: "always" }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.returnNativePetFromOuting).toHaveBeenCalledWith({ side: "left", generation: 1 });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it.each(["retreat", "return"] as const)("recovers native presence when drift-only %s fails", async (step) => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, "drift_only");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    if (step === "retreat") bridge.exitNativePetScreen.mockRejectedValueOnce(new Error("native exit failed"));
    else bridge.returnNativePetFromOuting.mockRejectedValueOnce(new Error("native return failed"));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    if (step === "return") {
      act(() => {
        window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, "always");
        window.dispatchEvent(new StorageEvent("storage", { key: PET_PRESENCE_MODE_STORAGE_KEY, newValue: "always" }));
      });
      await act(async () => undefined);
    }
    expect(bridge.setNativePetPresence).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("retries the retreat when another action supersedes it mid-walk", async () => {
    // A stuck "away" flag would silently disable both the retreat scheduler
    // and the hover controls while the cat is actually still on screen.
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, "drift_only");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishExit!: (ticket: { side: string; generation: number }) => void;
    bridge.exitNativePetScreen.mockImplementationOnce(() => new Promise((resolve) => {
      finishExit = resolve;
    }));

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.resolve();
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);

    // Something else takes the cat over while the walk-off is still in flight.
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "stop" }));
    await act(async () => {
      finishExit({ side: "left", generation: 1 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.setNativePetPresence).not.toHaveBeenCalledWith(false, 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(2);
  });

  it("walks off again after an automatic close called the away cat in", async () => {
    // Automatic close runs on its own schedule and can fire while the
    // drift-only cat is still away. Without recording that visit the cat
    // stayed on screen after the close, with no retreat and no hover controls.
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, "drift_only");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });

    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.resolve();
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(1);
    expect(bridge.setNativePetPresence).toHaveBeenCalledWith(false, 1);

    // Automatic close pulls the away cat in to close a tab.
    act(() => bridge.eventHandler?.({
      kind: "intervention",
      target: { id: "close-while-away", appName: "Safari", browserName: "Safari", preview: false },
    }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
    });
    expect(bridge.moveNativePetToTarget).toHaveBeenCalled();
    // The stale edge ticket must not survive the visit.
    expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();

    // Once focus holds again the visit ends the normal way: it walks back off.
    act(() => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "code", durationSeconds: 5 },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      await Promise.resolve();
    });
    expect(bridge.exitNativePetScreen).toHaveBeenCalledTimes(2);
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
    expect(screen.queryByLabelText("Drifty pet cat")).toBeNull();

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

    // The one-time quieter-step suggestion has already been shown here; the
    // first Turn Off is covered separately.
    window.localStorage.setItem(PET_TURN_OFF_SUGGESTION_SEEN_STORAGE_KEY, "1");
    actions.onTurnOffPet();
    expect(bridge.triggerNativePetVisibilityAction).toHaveBeenCalledWith("turnOff");

    actions.onOpenDashboard();
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("openDashboard");

    actions.onOpenSettings();
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("openSettings");

  });

  it("offers drift-only presence once before the first Turn Off", async () => {
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let resolveMenu: (() => void) | null = null;
    bridge.openNativePetModeMenu.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      resolveMenu = () => resolve(true);
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    pet.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    await act(async () => undefined);

    const actions = bridge.openNativePetModeMenu.mock.calls[0][0];
    actions.onTurnOffPet();
    // Nothing is turned off yet; the follow-up waits for this menu to close.
    expect(bridge.triggerNativePetVisibilityAction).not.toHaveBeenCalledWith("turnOff");
    expect(bridge.openNativePetTurnOffSuggestionMenu).not.toHaveBeenCalled();

    act(() => resolveMenu?.());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.openNativePetTurnOffSuggestionMenu).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(PET_TURN_OFF_SUGGESTION_SEEN_STORAGE_KEY)).toBe("1");

    const suggestion = bridge.openNativePetTurnOffSuggestionMenu.mock.calls[0][0];
    suggestion.onChooseDriftOnly();
    expect(window.localStorage.getItem(PET_PRESENCE_MODE_STORAGE_KEY)).toBe("drift_only");
    expect(bridge.triggerNativePetVisibilityAction).not.toHaveBeenCalledWith("turnOff");

    suggestion.onConfirmTurnOff();
    expect(bridge.triggerNativePetVisibilityAction).toHaveBeenCalledWith("turnOff");
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
    await renderResidentPet();

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
    await renderResidentPet();
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
    await renderResidentPet();

    expect(document.documentElement.dataset.surface).toBe("pet-mode");
    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 1, clientX: 10, clientY: 10 });
    dispatchPointer(pet, "pointermove", { pointerId: 1, clientX: 20, clientY: 10 });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.beginNativePetDrag).toHaveBeenCalledTimes(1);
    expect(bridge.beginNativePetDrag).toHaveBeenCalledWith(10, 10, PET_MODE_DRAG_PICKUP_MS, undefined, expect.any(String));
  });

  it.each(["mouse", "touch", "pen", undefined])(
    "preserves the original down point and %s pointer kind before a fast release",
    async (pointerType) => {
      vi.useFakeTimers();
      vi.stubGlobal("matchMedia", () => ({ matches: false }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ frames: walkFrames }) }));
      let completeNativeDrag!: () => void;
      bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise((resolve) => {
        completeNativeDrag = () => resolve({ moved: false, startX: 120, startY: 80,
          endX: 120, endY: 80 });
      }));
      await renderResidentPet();
      const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
      dispatchPointer(pet, "pointerdown", { pointerId: 43, clientX: 31, clientY: 62, pointerType });
      // The invoke must already own the down point. A move/up before the
      // pickup hold or before the native promise resolves cannot replace it.
      expect(bridge.beginNativePetDrag).toHaveBeenCalledWith(31, 62, PET_MODE_DRAG_PICKUP_MS, pointerType, expect.any(String));
      dispatchPointer(pet, "pointermove", { pointerId: 43, clientX: 91, clientY: 82, pointerType });
      dispatchPointer(pet, "pointerup", { pointerId: 43, clientX: 91, clientY: 82, pointerType });
      expect(bridge.beginNativePetDrag).toHaveBeenCalledTimes(1);
      await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    },
  );

  it("settles a completed fast mouse drag without resurrecting pickup on a late start event", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ frames: walkFrames }) }));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise((resolve) => {
      completeNativeDrag = () => resolve({ moved: true, strokeDetected: false,
        startX: 120, startY: 80, endX: 210, endY: 125 });
    }));
    await renderResidentPet();
    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 44, clientX: 31, clientY: 62, pointerType: "mouse" });
    dispatchPointer(pet, "pointerup", { pointerId: 44, clientX: 91, clientY: 82, pointerType: "mouse" });
    await act(async () => { completeNativeDrag(); await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.resolveNativePetDrop).toHaveBeenCalled();
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("release");
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("release");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).not.toBe("drag");
  });

  it("applies native facing updates before movement so the cat never walks backward", async () => {
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    await renderResidentPet();

    await act(async () => {
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
    window.localStorage.setItem(PET_MODE_FAST_RUN_STORAGE_KEY, "1");
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

  it("defaults to authored fast run and applies opt-out storage updates live", async () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    // Previous builds wrote the beta's default OFF automatically on startup.
    // That retired default must not suppress the production animation.
    window.localStorage.setItem("drifty.pet.fastRunBeta.v1", "0");
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
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-region-id")).toBe("run-gait:0");

    await act(async () => {
      window.localStorage.setItem(PET_MODE_FAST_RUN_STORAGE_KEY, "1");
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_FAST_RUN_STORAGE_KEY,
        newValue: "1",
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-region-id")).toBe("run-gait:0");

    act(() => {
      window.localStorage.setItem(PET_MODE_FAST_RUN_STORAGE_KEY, "0");
      window.dispatchEvent(new StorageEvent("storage", {
        key: PET_MODE_FAST_RUN_STORAGE_KEY,
        newValue: "0",
      }));
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-region-id")).toBe("gait:0");
  });

  it("returns to the ordinary idle artwork when native reports entry arrival", async () => {
    vi.useFakeTimers();
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
    expect(cat.style.getPropertyValue("--pet-gait-baseline-shift")).toBe(`${PET_MODE_GAIT_BASELINE_SHIFT_PX}px`);
    expect(cat.style.getPropertyValue("--pet-gait-center-shift")).toBe(`${PET_MODE_GAIT_CENTER_SHIFT_PX}px`);
    const entryVector = cat.querySelector(".pet-mode-cat__vector");
    expect(entryVector).not.toBeNull();

    await act(async () => {
      bridge.eventHandler?.({ kind: "entry_complete" });
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(cat.querySelector(".pet-mode-cat__vector")).toBeNull();
    expect(cat.getAttribute("data-region-id")).toBe("idle");
    expect(cat.classList.contains("is-entry-landed")).toBe(false);
  });

  it("waits for native completion throughout a long walk home", async () => {
    vi.useFakeTimers();
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
      bridge.eventHandler?.({ kind: "motion", motion: "entry", travelDistance: 900, durationMs: 43269 });
      await Promise.resolve();
    });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("entry");
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(cat.getAttribute("data-phase")).toBe("entry");
    expect(bridge.setNativePetPresence).not.toHaveBeenCalledWith(true);
    await act(async () => { bridge.eventHandler?.({ kind: "entry_complete" }); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
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
  }, LONG_CLOCK_TEST_TIMEOUT_MS);

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

  it("reveals the native panel after Stop interrupts an away outing and keeps the next dance visible", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let nativeVisible = true;
    await bridge.setNativePetPresence.withImplementation(async (visible: boolean) => {
      nativeVisible = visible;
    }, async () => {
      render(<PetModeWindowApp />);
      await act(async () => undefined);
      act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
      await act(async () => {
        bridge.eventHandler?.({ kind: "preview_action", action: "outing" });
      });
      expect(nativeVisible).toBe(false);

      await act(async () => {
        bridge.eventHandler?.({ kind: "preview_action", action: "stop" });
      });
      expect(nativeVisible).toBe(true);
      expect(bridge.setNativePetPresence).toHaveBeenLastCalledWith(true);
      expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");

      await act(async () => {
        bridge.eventHandler?.({ kind: "preview_action", action: "dance" });
      });
      expect(nativeVisible).toBe(true);
      expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("dance");
      await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });
      expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();
      expect(nativeVisible).toBe(true);
    });
  });

  it("does not let a delayed Stop reveal overwrite a newer dance", async () => {
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
    await act(async () => {
      bridge.eventHandler?.({ kind: "preview_action", action: "outing" });
    });
    let finishReveal!: () => void;
    bridge.setNativePetPresence.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishReveal = resolve;
    }));
    await act(async () => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stop" });
    });
    expect(bridge.setNativePetPresence).toHaveBeenLastCalledWith(true);
    await act(async () => {
      bridge.eventHandler?.({ kind: "preview_action", action: "dance" });
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("dance");

    await act(async () => { finishReveal(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("dance");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });
    expect(bridge.returnNativePetFromOuting).not.toHaveBeenCalled();
  });

  it("keeps a resident focused Stop in place without issuing a native home reveal", async () => {
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
    await act(async () => {
      bridge.eventHandler?.({
        kind: "snapshot",
        snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 42 },
      });
    });
    bridge.setNativePetPresence.mockClear();
    await act(async () => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stop" });
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");
    expect(bridge.setNativePetPresence).not.toHaveBeenCalled();
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

  it.each(["exit", "hide", "return"] as const)("recovers native presence after an outing %s fails", async (step) => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    const failure = new Error("No monitor is available for Pet Mode");
    if (step === "exit") bridge.exitNativePetScreen.mockRejectedValueOnce(failure);
    if (step === "hide") bridge.setNativePetPresence.mockRejectedValueOnce(failure);
    if (step === "return") bridge.returnNativePetFromOuting.mockRejectedValueOnce(failure);
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "outing" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });

    // Returning the renderer to idle alone leaves the native panel hidden or
    // beyond the display edge. Recovery must restore the native home too.
    expect(bridge.setNativePetPresence).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("does not overwrite a newer dance when failed-outing recovery finishes", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.returnNativePetFromOuting.mockRejectedValueOnce(new Error("native return failed"));
    let finishRecovery!: () => void;
    bridge.setNativePetPresence.mockResolvedValueOnce(undefined).mockImplementationOnce(() => new Promise<void>((resolve) => { finishRecovery = resolve; }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "entry_complete" }));
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "outing" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });
    expect(bridge.setNativePetPresence).toHaveBeenLastCalledWith(true);
    await act(async () => { bridge.eventHandler?.({ kind: "preview_action", action: "dance" }); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("dance");
    await act(async () => { finishRecovery(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("dance");
  });

  it("bounds failed-outing recovery when the native reveal also fails", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.returnNativePetFromOuting.mockRejectedValueOnce(new Error("native return failed"));
    bridge.setNativePetPresence.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("native reveal failed"));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "outing" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(bridge.setNativePetPresence.mock.calls).toEqual([[false, 1], [true]]);
  });

  it.each(["off", "hide"] as const)("does not recover a failed outing after a newer %s", async (action) => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let rejectReturn!: (error: Error) => void;
    bridge.returnNativePetFromOuting.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectReturn = reject; }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "outing" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_600); });
    const key = action === "off" ? PET_MODE_STORAGE_KEY : PET_MODE_HIDDEN_UNTIL_STORAGE_KEY;
    const value = action === "off" ? "0" : String(Date.now() + 60_000);
    window.localStorage.setItem(key, value);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key, newValue: value })));
    bridge.setNativePetPresence.mockClear();
    await act(async () => { rejectReturn(new Error("native return failed")); });

    expect(bridge.setNativePetPresence).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Drifty pet cat")).toBeNull();
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

    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(cat.getAttribute("data-phase")).toBe("entry");
    expect(bridge.setNativePetPresence).not.toHaveBeenCalledWith(true);
    await act(async () => {
      vi.advanceTimersByTime(PET_MODE_ENTRY_MAX_DURATION_MS - 12_000 + PET_MODE_ENTRY_FALLBACK_GRACE_MS);
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(screen.getByRole("button").classList.contains("is-entering")).toBe(false);
    expect(bridge.setNativePetPresence).toHaveBeenCalledWith(true);
  });

  it("restarts the fallback deadline when native begins a newer entry", async () => {
    vi.useFakeTimers();
    // Keep the independent random tail flick quiet while checking entry recovery.
    vi.spyOn(Math, "random").mockReturnValue(0.7);
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

    // Check the restarted deadline itself, before an unrelated idle animation
    // can change the phase during the extra 121ms already advanced above.
    await act(async () => {
      vi.advanceTimersByTime(PET_MODE_ENTRY_DURATION_MS + PET_MODE_ENTRY_FALLBACK_GRACE_MS - 121 - 1);
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("entry");

    await act(async () => {
      vi.advanceTimersByTime(1);
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
    await renderResidentPet();

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
    await renderResidentPet();

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
    await renderResidentPet();

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
    await renderResidentPet();

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
    await renderResidentPet();

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
    await renderResidentPet();
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
    await renderResidentPet();

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
    await renderResidentPet();

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
    await renderResidentPet();

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

  it("lets a Lab action preempt a native walk that is still in progress", async () => {
    vi.useFakeTimers();
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishWalk: (() => void) | null = null;
    bridge.roamNativePet.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishWalk = resolve;
    }));
    await renderResidentPet();

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "walk" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("walk");

    // A Lab action is a command: the walk drops and the stretch starts now.
    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stretch" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("stretch");

    // The superseded walk finishing later must not steal the pose back.
    await act(async () => { finishWalk?.(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("stretch");

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_LIFE_MOTION_DURATION_MS); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("lets a Lab action interrupt a running life action, and plays the dance from the Lab", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    await renderResidentPet();

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "tail_flick" });
    });
    await act(async () => { await Promise.resolve(); });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("tail");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(cat.getAttribute("data-phase")).toBe("tail");

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "dance" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("dance");
    expect(cat.querySelector("img")?.getAttribute("src")).toBe("/pet-mode/dance/f001.png");

    // The cancelled tail flick's own timer (3.1 s from its start) fires while
    // the 2.4 s dance is still playing and must not end it early.
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_TAIL_FLICK_DURATION_MS - 1_000 + 1); });
    expect(PET_MODE_TAIL_FLICK_DURATION_MS - 1_000 + 1).toBeLessThan(PET_MODE_DANCE_DURATION_MS);
    expect(cat.getAttribute("data-phase")).toBe("dance");

    // Only the remaining dance hold. Advancing a full extra cycle overshoots
    // into the idle blink scheduler (4.4–7.3 s) and flakes as `blink`.
    const remainingDanceMs = PET_MODE_DANCE_DURATION_MS
      - (PET_MODE_TAIL_FLICK_DURATION_MS - 1_000 + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(remainingDanceMs + 50);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("keeps the user's drag ahead of Lab commands", async () => {
    vi.useFakeTimers();
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let completeNativeDrag!: () => void;
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise((resolve) => {
      completeNativeDrag = () => resolve({
        moved: true,
        strokeDetected: false,
        startX: 120,
        startY: 80,
        endX: 240,
        endY: 80,
      });
    }));
    await renderResidentPet();
    const cat = screen.getByLabelText("Drifty pet cat");

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 43, clientX: 12, clientY: 12 });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("drag");

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "dance" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("drag");

    await act(async () => { completeNativeDrag(); await Promise.resolve(); await Promise.resolve(); });
  });

  it("runs the Lab life loop at a reviewable QA cadence and Stop cancels it", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    await renderResidentPet();

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "life_loop" });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(360); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("stretch");

    await act(async () => {
      bridge.eventHandler?.({ kind: "preview_action", action: "stop" });
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
  });

  it("settles contact alignment on arrival, then reports contact on frame 15 at the authored beat even with reduced motion", async () => {
    vi.useFakeTimers();
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    let finishMove!: () => void;
    bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise((resolve) => {
      finishMove = () => resolve({
        facing: "left",
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
    const hitTarget = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const contactAnchor = document.querySelector(".pet-mode-contact-anchor");
    if (!(contactAnchor instanceof HTMLElement)) throw new Error("contact anchor missing");
    vi.spyOn(hitTarget, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 154,
      bottom: 119,
      width: 144,
      height: 99,
      toJSON: () => ({}),
    });
    vi.spyOn(contactAnchor, "getBoundingClientRect").mockReturnValue({
      x: 153,
      y: 60,
      left: 153,
      top: 60,
      right: 153,
      bottom: 60,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    });

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
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.moveNativePetToTarget).toHaveBeenCalledTimes(1);
    expect(bridge.alignNativePetContact).not.toHaveBeenCalled();

    await act(async () => {
      finishMove();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.alignNativePetContact).toHaveBeenCalledWith(expect.objectContaining({
      targetX: 640,
      targetY: 48,
      anchorX: 1,
      anchorY: 40,
      diagnostic: "ax_selected_tab_close",
    }));
    expect(bridge.reportNativePetContact).not.toHaveBeenCalled();

    // The system asks for reduced motion here, yet the paw keeps its authored
    // beat: seven prep frames at 2/3 of 1/24s, seven lift frames at 1/24s, and
    // a 34ms paint wait put contact about 520ms after arrival. The old
    // reduced-motion shortcut made contact after ~116ms, which together with
    // the native jump read as a teleport on Windows.
    await act(async () => { await vi.advanceTimersByTimeAsync(480); });
    expect(bridge.reportNativePetContact).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(80); });
    expect(bridge.alignNativePetContact).toHaveBeenCalledTimes(1);
    expect(bridge.reportNativePetContact).toHaveBeenCalledTimes(1);
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("drift-1");
    expect(bridge.alignNativePetContact.mock.invocationCallOrder[0])
      .toBeLessThan(bridge.reportNativePetContact.mock.invocationCallOrder[0]);
  });

  it.each(["contact", "stop", "pause"] as const)("redirects a completed automatic return without losing the new approach's ownership (%s)", async (outcome) => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishOldReturn!: () => void;
    bridge.returnNativePetHome.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishOldReturn = resolve;
    }));
    await renderResidentPet();
    const send = (id: string) => bridge.eventHandler?.({
      kind: "intervention", target: { id, appName: "Google Chrome", browserName: "Google Chrome", preview: false },
    });
    act(() => { send("first-close"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PAW_SCENE_SETTLE_MS); });
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("first-close");
    expect(bridge.returnNativePetHome).toHaveBeenCalledTimes(1);

    let finishNewApproach!: () => void;
    if (outcome !== "pause") {
      bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise((resolve) => {
        finishNewApproach = () => resolve({
          facing: "right", targetKind: "browser_tab_close", motionOutcome: "completed",
          confidence: "high", diagnostic: "ax_selected_tab_close", targetX: 640, targetY: 48,
        });
      }));
    }
    const cancellationsBefore = bridge.cancelNativePetMotion.mock.calls.length;
    let finishRedirect!: () => void;
    if (outcome === "pause") {
      bridge.cancelNativePetMotion.mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishRedirect = resolve;
      }));
    }
    await act(async () => { send("reentry-close"); });
    expect(bridge.cancelNativePetMotion.mock.calls.length).toBe(cancellationsBefore + 1);
    if (outcome === "pause") {
      await act(async () => {
        window.localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify(buildAutomaticCloseOverride(false, "15")));
        window.dispatchEvent(new StorageEvent("storage", { key: AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY }));
      });
      await act(async () => { finishOldReturn(); finishRedirect(); });
      expect(bridge.moveNativePetToTarget).toHaveBeenCalledTimes(1);
      expect(bridge.reportNativePetContact).not.toHaveBeenCalledWith("reentry-close");
      expect(bridge.reportNativePetContact).toHaveBeenCalledWith("reentry-close", false, "renderer_action_cancelled");
      expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sleep");
      return;
    }
    expect(bridge.moveNativePetToTarget).toHaveBeenCalledTimes(2);

    // Native cancellation can settle the old walk after the new action owns
    // the renderer. Its finally blocks must leave the new action in control.
    await act(async () => { finishOldReturn(); });
    act(() => { send("duplicate-during-approach"); });
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith(
      "duplicate-during-approach", false, "renderer_busy_intervention",
    );
    expect(bridge.moveNativePetToTarget).toHaveBeenCalledTimes(2);
    expect(bridge.reportNativePetContact).not.toHaveBeenCalledWith(
      "reentry-close", false, "renderer_busy_intervention",
    );
    if (outcome === "stop") {
      await act(async () => { bridge.eventHandler?.({ kind: "preview_action", action: "stop" }); });
    }
    await act(async () => { finishNewApproach(); await vi.advanceTimersByTimeAsync(PAW_SCENE_SETTLE_MS); });
    if (outcome === "stop") {
      expect(bridge.reportNativePetContact).not.toHaveBeenCalledWith("reentry-close");
      expect(bridge.reportNativePetContact).toHaveBeenCalledWith("reentry-close", false, "renderer_action_cancelled");
    } else {
      expect(bridge.reportNativePetContact).toHaveBeenCalledWith("reentry-close");
      expect(bridge.returnNativePetHome).toHaveBeenCalledTimes(2);
    }
  });

  it.each([
    ["catch", false], ["catch", true], ["focus", false], ["focus", true],
    ["pause", false], ["pause", true], ["stop", false], ["preview", false], ["none", true],
  ] as const)("reports exactly one result when %s interrupts the return-to-approach handoff (native failure: %s)", async (outcome, nativeFailure) => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishOldReturn!: () => void;
    bridge.returnNativePetHome.mockImplementationOnce(() => new Promise<void>((resolve) => { finishOldReturn = resolve; }));
    await renderResidentPet();
    const send = (id: string) => bridge.eventHandler?.({ kind: "intervention", target: {
      id, appName: "Google Chrome", browserName: "Google Chrome", preview: false,
    } });
    act(() => { send("first-close"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PAW_SCENE_SETTLE_MS); });
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("first-close");
    expect(bridge.returnNativePetHome).toHaveBeenCalledTimes(1);

    // Run the real main-window contact bridge against the renderer's result;
    // only the native event transport is replaced. A catch must settle as
    // user intent, a context change as cancellation, and native errors must
    // remain technical failures rather than receiving catch grace.
    const nativeBridge = await vi.importActual<typeof import("./petModeBridge")>("./petModeBridge");
    bridge.isTauri.mockReturnValue(true);
    const unlisten = vi.fn();
    let sendContact!: (payload: { id: string; contacted: boolean; reason: string | null }) => void;
    bridge.contactListen.mockImplementation(async (event: string, handler: (event: { event: string; id: number; payload: unknown }) => void) => {
      sendContact = (payload) => handler({ event, id: 0, payload });
      return unlisten;
    });
    bridge.reportNativePetContact.mockImplementationOnce(async (id: string, contacted = true, reason: string | null = null) => {
      sendContact({ id, contacted, reason });
    });
    const target = { id: "reentry-close", appName: "Google Chrome", browserName: "Google Chrome", preview: false };
    const result = nativeBridge.playNativePetModeIntervention(target);
    await act(async () => undefined);
    expect(bridge.contactInvoke).toHaveBeenCalledWith("pet_mode_intervene", { target });

    let settleRedirect!: () => void;
    bridge.cancelNativePetMotion.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      settleRedirect = nativeFailure ? () => reject(new Error("Native cancellation failed")) : resolve;
    }));
    await act(async () => { send("reentry-close"); });
    await act(async () => {
      if (outcome === "catch") {
        dispatchPointer(screen.getByRole("button", { name: /Pet Drifty cat/ }), "pointerdown", { pointerId: 42, clientX: 60, clientY: 50 });
        bridge.dragStartHandler?.();
      } else if (outcome === "focus") {
        bridge.eventHandler?.({ kind: "snapshot", snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 120 } });
      } else if (outcome === "pause") {
        window.localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify(buildAutomaticCloseOverride(false, "15")));
        window.dispatchEvent(new StorageEvent("storage", { key: AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY }));
      } else if (outcome === "stop") {
        bridge.eventHandler?.({ kind: "preview_action", action: "stop" });
      } else if (outcome === "preview") {
        bridge.eventHandler?.({ kind: "preview_action", action: "tail_flick" });
      }
    });
    await act(async () => { settleRedirect(); });
    const reason = outcome === "catch" ? "user_intercepted"
      : outcome === "focus" ? "activity_context_changed"
        : nativeFailure && outcome === "none" ? "renderer_intervention_failed" : "renderer_action_cancelled";
    const results = () => bridge.reportNativePetContact.mock.calls.filter(([id]) => id === "reentry-close");
    expect(results()).toEqual([["reentry-close", false, reason]]);
    await expect(result).resolves.toMatchObject({
      outcome: outcome === "catch" ? "user_intercepted" : outcome === "focus" ? "cancelled" : "rejected",
      reason,
    });
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(bridge.moveNativePetToTarget).toHaveBeenCalledTimes(1);
    // A late completion belongs to the first target and cannot contact or
    // send another cancellation for the reentry target.
    await act(async () => { finishOldReturn(); await vi.advanceTimersByTimeAsync(100); });
    expect(results()).toEqual([["reentry-close", false, reason]]);
    expect(bridge.reportNativePetContact.mock.calls.filter(([id]) => id === "first-close")).toEqual([["first-close"]]);
    if (outcome === "focus" || outcome === "pause") {
      expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe(outcome === "focus" ? "sit" : "sleep");
    }
    if (outcome !== "none") expect(bridge.returnNativePetHome).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit Lab ownership when an automatic return settles after a preview starts", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    let finishReturn!: () => void;
    bridge.returnNativePetHome.mockImplementationOnce(() => new Promise<void>((resolve) => { finishReturn = resolve; }));
    await renderResidentPet();
    act(() => { bridge.eventHandler?.({ kind: "intervention", target: {
      id: "automatic-before-lab", appName: "Google Chrome", browserName: "Google Chrome", preview: false,
    } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PAW_SCENE_SETTLE_MS); });
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("automatic-before-lab");
    expect(bridge.returnNativePetHome).toHaveBeenCalledTimes(1);
    await act(async () => { bridge.eventHandler?.({ kind: "preview_action", action: "dance" }); });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("dance");
    await act(async () => { finishReturn(); });
    expect(cat.getAttribute("data-phase")).toBe("dance");
    await act(async () => { bridge.eventHandler?.({ kind: "snapshot", snapshot: { productivity: "focus", contextLabel: "editor", durationSeconds: 120 } }); });
    expect(cat.getAttribute("data-phase")).toBe("dance");
  });

  it("celebrates with dance after closing when danceOnCloseBeta is enabled", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_DANCE_ON_CLOSE_BETA_STORAGE_KEY, "1");
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drift-dance-1",
          appName: "Google Chrome",
          browserName: "Google Chrome",
          preview: false,
        },
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(bridge.moveNativePetToTarget).toHaveBeenCalledTimes(1);

    // Reduced motion (matches: true) keeps the authored paw beat: contact
    // lands about 520ms after arrival.
    await act(async () => { await vi.advanceTimersByTimeAsync(560); });
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("drift-dance-1");

    // The paw return ends about 1000ms after arrival. The decorative dance
    // still honors reduced motion, so its hold is only 40ms after that.
    await act(async () => { await vi.advanceTimersByTimeAsync(420); });
    expect(bridge.returnNativePetHome).not.toHaveBeenCalled();

    // Advancing past the paw return and the 40ms dance hold starts the walk home.
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(bridge.returnNativePetHome).toHaveBeenCalledTimes(1);
    // The panel borrowed headroom for the 1:1 upright pose and gave it back
    // before the walk home started.
    expect(bridge.setNativePetDanceHeadroom.mock.calls).toEqual([[true], [false]]);
    const raiseOrder = bridge.setNativePetDanceHeadroom.mock.invocationCallOrder[1];
    const returnOrder = bridge.returnNativePetHome.mock.invocationCallOrder[0];
    expect(raiseOrder).toBeLessThan(returnOrder);
  });

  it("raises dance headroom before the Lab dance pose and lowers it when the pose ends or is interrupted", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    await renderResidentPet();
    const cat = screen.getByLabelText("Drifty pet cat");

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "dance" });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("dance");
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenCalledTimes(1);
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenLastCalledWith(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DANCE_DURATION_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenLastCalledWith(false);
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenCalledTimes(2);

    // Interrupting a dance with another Lab action lowers the headroom too.
    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "dance" });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("dance");
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenCalledTimes(3);
    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "blink" });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("blink");
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenLastCalledWith(false);
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenCalledTimes(4);
    // The cancelled dance's own timer must not lower it again later.
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DANCE_DURATION_MS); });
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenCalledTimes(4);
  });

  it("does not commit the upright pose when native edge preparation fails", async () => {
    bridge.setNativePetDanceHeadroom.mockRejectedValueOnce(new Error("edge preparation failed"));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    await renderResidentPet();
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "dance" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenCalledWith(true);
  });

  it("does not keep dance headroom if the native raise loses the pose mid-flight", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let finishRaise: ((value: boolean) => void) | null = null;
    bridge.setNativePetDanceHeadroom.mockImplementation((active: boolean) => {
      if (active) {
        return new Promise<boolean>((resolve) => { finishRaise = resolve; });
      }
      return Promise.resolve(true);
    });
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    await renderResidentPet();
    const cat = screen.getByLabelText("Drifty pet cat");

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "dance" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).not.toBe("dance");
    expect(finishRaise).not.toBeNull();

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "blink" });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("blink");

    await act(async () => { finishRaise?.(true); await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("blink");
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenLastCalledWith(false);
  });

  it("keeps a newer dance prepared when an interrupted native raise resolves late", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    let finishOldRaise: ((value: boolean) => void) | null = null;
    bridge.setNativePetDanceHeadroom.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finishOldRaise = resolve; }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    await renderResidentPet();
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "dance" }));
    await act(async () => { await Promise.resolve(); });
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "blink" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "dance" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("dance");
    const callsBeforeOldAck = bridge.setNativePetDanceHeadroom.mock.calls.length;
    await act(async () => { finishOldRaise?.(true); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("dance");
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenCalledTimes(callsBeforeOldAck);
    expect(bridge.setNativePetDanceHeadroom).toHaveBeenLastCalledWith(true);
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
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
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
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith(
      "drift-without-geometry",
      false,
      "target_unavailable:accessibility_target_unavailable",
    );
    expect(bridge.returnNativePetHome).not.toHaveBeenCalled();
  });

  it("refuses to point at a tab strip hotspot native could not tie to the active tab", async () => {
    // Observed 2026-09-08 on Aside: the tab strip still reported "StayFree"
    // as AXSelected while the browser's active tab was an Agent Tab page. The
    // old resolver ran the cat to that far-right tab edge, the automatic
    // close removed the real active tab, and the cat came home proud.
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.moveNativePetToTarget.mockResolvedValueOnce({
      facing: "right",
      targetKind: "fallback",
      motionOutcome: "not_attempted",
      confidence: "low",
      diagnostic: "browser_tab_selected_mismatch",
      targetX: 1482,
      targetY: 52,
    });
    await renderResidentPet();

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drift-aside-agent-tab",
          appName: "Aside",
          browserName: "Aside",
          preview: false,
        },
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
    expect(bridge.reportNativePetContact).toHaveBeenCalledTimes(1);
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith(
      "drift-aside-agent-tab",
      false,
      "target_unavailable:browser_tab_selected_mismatch",
    );
    expect(bridge.alignNativePetContact).not.toHaveBeenCalled();
    expect(bridge.returnNativePetHome).not.toHaveBeenCalled();
  });

  it("keeps the target_unavailable base token and never forwards free-form text", () => {
    expect(formatTargetUnavailableReason("browser_tab_selected_mismatch"))
      .toBe("target_unavailable:browser_tab_selected_mismatch");
    expect(formatTargetUnavailableReason("")).toBe("target_unavailable");
    expect(formatTargetUnavailableReason(null)).toBe("target_unavailable");
    expect(formatTargetUnavailableReason(undefined)).toBe("target_unavailable");
    expect(formatTargetUnavailableReason("StayFree - Aside")).toBe("target_unavailable");
    expect(formatTargetUnavailableReason("title:https://example.com")).toBe("target_unavailable");
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
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await renderResidentPet();

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
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith(
      "browser-x-fallback",
      false,
      "target_unavailable:accessibility_target_unavailable",
    );
  });

  it("returns home even when the native contact signal fails", async () => {
    vi.useFakeTimers();
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.reportNativePetContact.mockRejectedValueOnce(new Error("contact unavailable"));
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
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
    await act(async () => { await vi.advanceTimersByTimeAsync(PAW_SCENE_SETTLE_MS); });

    expect(bridge.returnNativePetHome).toHaveBeenCalledTimes(1);
  });

  it("lets native movement distinguish a cat tap from a real panel drag", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    await renderResidentPet();

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
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.beginNativePetDrag.mockResolvedValueOnce({
      moved: true,
      strokeDetected: false,
      startX: 120,
      startY: 80,
      endX: 240,
      endY: 140,
    });
    await renderResidentPet();

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
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
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
    await renderResidentPet();

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 42, clientX: 12, clientY: 12, pointerType: "mouse" });
    await act(async () => { bridge.dragStartHandler?.(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("drag");

    await act(async () => { bridge.strokeDetectedHandler?.(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).not.toBe("drag");

    await act(async () => { completeNativeDrag(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("happy");
  });

  it("turns a tap during motion into petting without flashing the held pose", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    await renderResidentPet();
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
    await renderResidentPet();
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
    await renderResidentPet();
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
    await renderResidentPet();
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
    await renderResidentPet();
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
    await renderResidentPet();

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
    expect(bridge.beginNativePetDrag).toHaveBeenCalledWith(18, 18, 0, undefined, expect.any(String));
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
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    await renderResidentPet();
    await act(async () => {
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
    expect(bridge.beginNativePetDrag).toHaveBeenCalledWith(18, 18, PET_MODE_DRAG_PICKUP_MS, undefined, expect.any(String));
    expect(phaseAtNativeCommandStart).toBe("run");
    expect(assetAtNativeCommandStart).toBeNull();
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("run");

    await act(async () => {
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
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    await renderResidentPet();

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
    await act(async () => {
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
        endX: 240,
        endY: 140,
      });
    }));
    await renderResidentPet();

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 10, clientX: 18, clientY: 18 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    await act(async () => {
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
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockResolvedValue(vi.fn());
    bridge.beginNativePetDrag.mockImplementationOnce(async () => new Promise(() => undefined));
    await renderResidentPet();

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 11, clientX: 18, clientY: 18 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    await act(async () => {
      bridge.dragStartHandler?.();
    });
    expect(cat.getAttribute("data-phase")).toBe("drag");

    await act(async () => {
      bridge.dragEndHandler?.({ moved: true, startX: 120, startY: 80, endX: 180, endY: 96 });
    });
    expect(cat.getAttribute("data-phase")).toBe("release");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"] as const)(
    "keeps B authoritative when A's invoke %s arrives after Off/On",
    async (completion) => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      vi.useFakeTimers();
      vi.stubGlobal("matchMedia", () => ({ matches: false }));
      bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
        bridge.eventHandler = handler;
        return vi.fn();
      });
      let resolveA!: (value: PetModeNativeDragResult) => void;
      let rejectA!: (reason: Error) => void;
      bridge.beginNativePetDrag
        .mockImplementationOnce(() => new Promise((resolve, reject) => { resolveA = resolve; rejectA = reject; }))
        .mockImplementationOnce(() => new Promise(() => undefined));
      await renderResidentPet();

      let pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
      let cat = screen.getByLabelText("Drifty pet cat");
      dispatchPointer(pet, "pointerdown", { pointerId: 30, clientX: 18, clientY: 18 });
      const idA = bridge.beginNativePetDrag.mock.calls[0]?.[4] as string;
      await act(async () => bridge.dragStartHandler?.(idA));
      expect(cat.getAttribute("data-phase")).toBe("drag");
      await act(async () => {
        window.localStorage.setItem(PET_MODE_STORAGE_KEY, "0");
        window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_STORAGE_KEY, newValue: "0" }));
      });
      await act(async () => {
        window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
        window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_STORAGE_KEY, newValue: "1" }));
        bridge.eventHandler?.({ kind: "entry_complete" });
      });
      // Off unmounts the hidden drawing; On renders a fresh hit target.
      pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
      cat = screen.getByLabelText("Drifty pet cat");
      dispatchPointer(pet, "pointerdown", { pointerId: 31, clientX: 24, clientY: 24 });
      expect(bridge.beginNativePetDrag).toHaveBeenCalledTimes(2);
      const idB = bridge.beginNativePetDrag.mock.calls[1]?.[4] as string;
      expect(idB).not.toBe(idA);

      await act(async () => {
        if (completion === "resolve") resolveA({ manualRequestId: idA, moved: true, startX: 120, startY: 80, endX: 240, endY: 140 });
        else rejectA(new Error("Pet Mode drag was cancelled"));
        await Promise.resolve();
      });
      // A cannot clear B's ownership: B's current start and end still work.
      await act(async () => bridge.dragStartHandler?.(idB));
      expect(cat.getAttribute("data-phase")).toBe("drag");
      expect(bridge.reportNativePetDragError).not.toHaveBeenCalled();
      expect(bridge.rememberNativePetPosition).not.toHaveBeenCalled();
      await act(async () => bridge.dragEndHandler?.({ manualRequestId: idB, moved: true, startX: 120, startY: 80, endX: 240, endY: 140 }));
      expect(cat.getAttribute("data-phase")).toBe("release");
      await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
      expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);
    },
  );

  it("leaves the next drag eligible when allocating a request ID fails", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.createPetManualDragRequestId.mockImplementationOnce(() => { throw new Error("clock is exhausted"); });
    bridge.beginNativePetDrag.mockImplementationOnce(() => new Promise(() => undefined));
    await renderResidentPet();
    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    dispatchPointer(pet, "pointerdown", { pointerId: 34, clientX: 24, clientY: 24 });
    expect(bridge.beginNativePetDrag).not.toHaveBeenCalled();
    expect(bridge.reportNativePetDragError).toHaveBeenCalledTimes(1);
    dispatchPointer(pet, "pointerdown", { pointerId: 35, clientX: 24, clientY: 24 });
    expect(bridge.beginNativePetDrag).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"] as const)(
    "ignores A's callbacks and invoke %s after actual unmount and B remount",
    async (completion) => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      vi.useFakeTimers();
      vi.stubGlobal("matchMedia", () => ({ matches: false }));
      bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
        bridge.eventHandler = handler;
        return vi.fn();
      });
      let resolveA!: (value: PetModeNativeDragResult) => void;
      let rejectA!: (reason: Error) => void;
      bridge.beginNativePetDrag
        .mockImplementationOnce(() => new Promise((resolve, reject) => { resolveA = resolve; rejectA = reject; }))
        .mockImplementationOnce(() => new Promise(() => undefined));
      const a = await renderResidentPet();
      dispatchPointer(screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." }),
        "pointerdown", { pointerId: 36, clientX: 18, clientY: 18 });
      const idA = bridge.beginNativePetDrag.mock.calls[0]?.[4] as string;
      const old = { start: bridge.dragStartHandler, stroke: bridge.strokeDetectedHandler,
        probe: bridge.dragProbeHandler, end: bridge.dragEndHandler };
      a.unmount();
      await renderResidentPet();
      dispatchPointer(screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." }),
        "pointerdown", { pointerId: 37, clientX: 24, clientY: 24 });
      const idB = bridge.beginNativePetDrag.mock.calls[1]?.[4] as string;
      const cat = screen.getByLabelText("Drifty pet cat");
      await act(async () => bridge.dragStartHandler?.(idB));
      expect(cat.getAttribute("data-phase")).toBe("drag");
      await act(async () => {
        old.start?.(idA);
        old.stroke?.(idA);
        old.probe?.(null, idA);
        old.end?.({ manualRequestId: idA, moved: true, startX: 120, startY: 80, endX: 180, endY: 96 });
        if (completion === "resolve") resolveA({ manualRequestId: idA, moved: true, startX: 120, startY: 80, endX: 180, endY: 96 });
        else rejectA(new Error("Pet Mode drag was cancelled"));
      });
      expect(cat.getAttribute("data-phase")).toBe("drag");
      expect(bridge.reportNativePetDragError).not.toHaveBeenCalled();
      expect(bridge.rememberNativePetPosition).not.toHaveBeenCalled();
      await act(async () => bridge.dragEndHandler?.({ manualRequestId: idB, moved: true, startX: 120, startY: 80, endX: 240, endY: 140 }));
      expect(cat.getAttribute("data-phase")).toBe("release");
      await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
      expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);
    },
  );

  it("ignores A's delayed start, stroke, probe and end after B claims the pet", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.beginNativePetDrag.mockImplementation(() => new Promise(() => undefined));
    await renderResidentPet();
    await act(async () => bridge.eventHandler?.({ kind: "guides", enabled: true }));
    let pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    let cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 32, clientX: 18, clientY: 18 });
    const idA = bridge.beginNativePetDrag.mock.calls[0]?.[4] as string;
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_STORAGE_KEY, newValue: "0" }));
    });
    await act(async () => {
      window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
      window.dispatchEvent(new StorageEvent("storage", { key: PET_MODE_STORAGE_KEY, newValue: "1" }));
      bridge.eventHandler?.({ kind: "entry_complete" });
    });
    pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 33, clientX: 24, clientY: 24 });
    expect(bridge.beginNativePetDrag).toHaveBeenCalledTimes(2);
    const idB = bridge.beginNativePetDrag.mock.calls[1]?.[4] as string;

    await act(async () => {
      bridge.dragStartHandler?.(idA);
      bridge.strokeDetectedHandler?.(idA);
      bridge.dragProbeHandler?.({ kind: "catch", distance: 9, durationMs: 140, targetY: 210, ledge: "Old A" }, idA);
      bridge.dragEndHandler?.({ manualRequestId: idA, moved: true, startX: 120, startY: 80, endX: 180, endY: 96 });
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
    expect(bridge.probeNativePetAxSeat).not.toHaveBeenCalled();
    expect(bridge.rememberNativePetPosition).not.toHaveBeenCalled();
    await act(async () => bridge.dragStartHandler?.(idB));
    expect(cat.getAttribute("data-phase")).toBe("drag");
    await act(async () => {
      bridge.dragProbeHandler?.({ kind: "catch", distance: 52, durationMs: 140, targetY: 210, ledge: "Current B" }, idB);
      await Promise.resolve();
    });
    expect(screen.getByText("낙하: Current B (52pt)")).toBeDefined();
    await act(async () => {
      bridge.strokeDetectedHandler?.(idA);
      bridge.dragProbeHandler?.(null, idA);
      bridge.dragEndHandler?.({ manualRequestId: idA, moved: true, startX: 120, startY: 80, endX: 180, endY: 96 });
    });
    expect(cat.getAttribute("data-phase")).toBe("drag");
    expect(screen.getByText("낙하: Current B (52pt)")).toBeDefined();
    await act(async () => bridge.dragEndHandler?.({ manualRequestId: idB, moved: true, startX: 120, startY: 80, endX: 240, endY: 140 }));
    expect(cat.getAttribute("data-phase")).toBe("release");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
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
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
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
    await renderResidentPet();
    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." });
    const cat = screen.getByLabelText("Drifty pet cat");
    dispatchPointer(pet, "pointerdown", { pointerId: 21, clientX: 18, clientY: 18 });
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_PICKUP_MS); });
    await act(async () => { bridge.dragStartHandler?.(); });
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
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
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
    await renderResidentPet();
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
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
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
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
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
