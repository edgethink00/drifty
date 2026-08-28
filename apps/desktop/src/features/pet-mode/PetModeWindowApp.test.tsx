// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  PET_MODE_PRESENT_MS,
  PET_MODE_STORAGE_KEY,
  PET_MODE_HIDDEN_UNTIL_STORAGE_KEY,
  PET_MODE_TAIL_FLICK_DURATION_MS,
  type PetModeWindowEvent,
} from "./petModeData";
import {
  PET_MODE_DRIFT_CURSOR_BITE_HOLD_MS,
  PET_MODE_DRIFT_HUNT_ENABLED_STORAGE_KEY,
  PET_MODE_DRIFT_NOTICE_MS,
  PET_MODE_DRIFT_NOTICE_SECONDS,
  PET_MODE_DRIFT_STALK_SECONDS,
} from "./petModeDriftHunt";

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
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  }) => void) | null,
  dragStartHandler: null as (() => void) | null,
  eventHandler: null as ((event: PetModeWindowEvent) => void) | null,
  listenToNativePetDragEnd: vi.fn().mockImplementation(async (handler) => {
    bridge.dragEndHandler = handler;
    return vi.fn();
  }),
  listenToNativePetDragStart: vi.fn().mockImplementation(async (handler) => {
    bridge.dragStartHandler = handler;
    return vi.fn();
  }),
  listenToNativePetDragProbe: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetModeEvent: vi.fn(),
  listenToNativePetModeLabStateRequest: vi.fn().mockResolvedValue(vi.fn()),
  moveNativePetToTarget: vi.fn().mockResolvedValue({
    facing: "right",
    targetKind: "browser_tab_close",
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
  exitNativePetScreen: vi.fn().mockResolvedValue("left"),
  returnNativePetFromOuting: vi.fn().mockResolvedValue(undefined),
  roamNativePet: vi.fn().mockResolvedValue(undefined),
  sampleNativePetCursor: vi.fn().mockResolvedValue(null),
  rememberNativePetPosition: vi.fn().mockResolvedValue(undefined),
  resolveNativePetDrop: vi.fn().mockResolvedValue({ kind: "hop", distance: 4, durationMs: 16, targetY: 0, ledge: "hop" }),
  setNativePetPresence: vi.fn().mockResolvedValue(undefined),
  stalkNativePetCursor: vi.fn().mockResolvedValue({
    outcome: "completed",
    facing: "right",
    cursorX: 640,
    cursorY: 320,
    cursorMovementDistance: 0,
  }),
  returnWithNativePetCursor: vi.fn().mockResolvedValue({ outcome: "completed", movedDistance: 128 }),
  triggerNativePetVisibilityAction: vi.fn().mockResolvedValue(undefined),
  triggerNativeEndOfDayReviewAction: vi.fn().mockResolvedValue(undefined),
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
  listenToNativePetDragProbe: bridge.listenToNativePetDragProbe,
  listenToNativePetModeEvent: bridge.listenToNativePetModeEvent,
  listenToNativePetModeLabStateRequest: bridge.listenToNativePetModeLabStateRequest,
  moveNativePetToTarget: bridge.moveNativePetToTarget,
  reportNativePetContact: bridge.reportNativePetContact,
  reportNativePetDragError: bridge.reportNativePetDragError,
  reportNativePetModeLabState: bridge.reportNativePetModeLabState,
  reportNativePetPointer: bridge.reportNativePetPointer,
  returnNativePetHome: bridge.returnNativePetHome,
  exitNativePetScreen: bridge.exitNativePetScreen,
  returnNativePetFromOuting: bridge.returnNativePetFromOuting,
  roamNativePet: bridge.roamNativePet,
  sampleNativePetCursor: bridge.sampleNativePetCursor,
  rememberNativePetPosition: bridge.rememberNativePetPosition,
  resolveNativePetDrop: bridge.resolveNativePetDrop,
  setNativePetPresence: bridge.setNativePetPresence,
  stalkNativePetCursor: bridge.stalkNativePetCursor,
  returnWithNativePetCursor: bridge.returnWithNativePetCursor,
  triggerNativePetVisibilityAction: bridge.triggerNativePetVisibilityAction,
}));

vi.mock("../companion/watcherBridge", () => ({
  isTauriRuntime: () => true,
  triggerNativeEndOfDayReviewAction: bridge.triggerNativeEndOfDayReviewAction,
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
    vi.clearAllMocks();
    bridge.stagePetModeHitRegionTransition.mockReset().mockResolvedValue(undefined);
    bridge.dragEndHandler = null;
    bridge.dragStartHandler = null;
    bridge.eventHandler = null;
    window.localStorage.clear();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.surface;
  });

  it("hard-stops automatic motion and gaze while focus is active", async () => {
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
    expect(bridge.sampleNativePetCursor).not.toHaveBeenCalled();
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
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("automatic-drift-nudge", false);
    expect(bridge.reportNativePetContact).not.toHaveBeenCalledWith("automatic-drift-nudge");
    expect(bridge.returnNativePetHome).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
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
      enabled: true,
      mode: "single",
      chaseDurationMs: 8_000,
      softTurns: true,
    });

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

  it("keeps cursor hunting inert until the Dev toggle is enabled", async () => {
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

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).not.toBe("stalk");
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();

    act(() => bridge.eventHandler?.({ kind: "preview_action", action: "cursor_hunt_single" }));
    await act(async () => { await Promise.resolve(); });
    expect(bridge.stalkNativePetCursor).not.toHaveBeenCalled();
  });

  it("runs the same native cursor hunt path from the enabled Dev preview", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
    window.localStorage.setItem("drifty.pet.driftHuntEnabled.v1", "true");
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
      enabled: true,
      mode: "chase",
      chaseDurationMs: 8_000,
      softTurns: true,
    });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("bite");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRIFT_CURSOR_BITE_HOLD_MS); });
    expect(bridge.returnWithNativePetCursor).toHaveBeenCalledWith({
      targetX: 640,
      targetY: 320,
      approachFacing: "right",
      cursorMovementDistance: 0,
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
    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenCalledWith("openDashboard");

    actions.onOpenSettings();
    expect(bridge.triggerNativeEndOfDayReviewAction).toHaveBeenCalledWith("openSettings");
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
      regionId: "idle",
      interactive: false,
    });

    await act(async () => {
      releases[0]?.();
      await Promise.resolve();
    });
    const publishCallsAfterSettled = bridge.publishPetModeHitRegion.mock.calls;
    expect(publishCallsAfterSettled[publishCallsAfterSettled.length - 1]?.[0]).toMatchObject({
      regionId: "idle",
      mirrored: true,
      interactive: true,
    });
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

  it("skips pretend paw choreography when native X geometry is unavailable", async () => {
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    bridge.moveNativePetToTarget.mockResolvedValueOnce({
      facing: "right",
      targetKind: "fallback",
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

    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("drift-without-geometry", false);
    expect(bridge.returnNativePetHome).not.toHaveBeenCalled();
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
    expect(bridge.reportNativePetContact).toHaveBeenCalledWith("browser-x-fallback", false);
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

  it("keeps a focused sitting cat continuous through pickup and release", async () => {
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
    expect(cat.getAttribute("data-region-id")).toBe("drag:sit");
    expect(cat.querySelector(".pet-mode-cat__drag-pending-rest .pet-mode-cat__sit-pose")).toBeTruthy();
    expect(cat.querySelector('.pet-mode-cat__drag-pending-rest img[src="/pet-mode/paw/f001.png"]')).toBeNull();

    await act(async () => { completeNativeDrag(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("release");
    expect(cat.getAttribute("data-region-id")).toBe("release:sit");
    expect(cat.querySelector(".pet-mode-cat__release-rest .pet-mode-cat__sit-pose")).toBeTruthy();
    expect(cat.querySelector('.pet-mode-cat__release-rest img[src="/pet-mode/paw/f001.png"]')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("sit");
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);
  });

  it("retargets an in-flight release when focus starts without interrupting the drop", async () => {
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
    expect(cat.getAttribute("data-region-id")).toBe("release:sit");
    expect(cat.querySelector(".pet-mode-cat__release-rest .pet-mode-cat__sit-pose")).toBeTruthy();
    expect(bridge.cancelNativePetMotion).toHaveBeenCalledTimes(cancellationCount);

    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("sit");
  });

  it("retargets an in-flight focused release when focus ends without interrupting the drop", async () => {
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
    expect(cat.getAttribute("data-region-id")).toBe("release:sit");
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
    expect(cat.getAttribute("data-region-id")).toBe("drag:sit");

    await act(async () => { completeNativeDrag(); await Promise.resolve(); await Promise.resolve(); });
    expect(cat.getAttribute("data-phase")).toBe("sit");
    expect(bridge.resolveNativePetDrop).not.toHaveBeenCalled();
    expect(bridge.rememberNativePetPosition).toHaveBeenCalledTimes(1);
  });

  it("lets focus take over after an explicit stop cancels an in-flight release", async () => {
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

  it("keeps the shipped settle when drop resolution hops", async () => {
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
    expect(bridge.resolveNativePetDrop).toHaveBeenCalled();
    expect(cat.getAttribute("data-phase")).toBe("release");
    await act(async () => { await vi.advanceTimersByTimeAsync(PET_MODE_DRAG_SETTLE_MS); });
    expect(cat.getAttribute("data-phase")).toBe("idle");
  });

  it("waits for a catch drop before returning to idle", async () => {
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

    act(() => {
      guidesHandler?.({ kind: "guides", enabled: true });
      probeHandler?.({ kind: "catch", distance: 52, durationMs: 140, targetY: 210, ledge: "Safari" });
    });
    expect(screen.getByText("낙하: Safari (52pt)")).toBeDefined();

    act(() => {
      probeHandler?.({ kind: "stay_top", distance: 0, durationMs: 0, targetY: 40, ledge: "menubar" });
    });
    expect(screen.getByText("상단 집 (안 떨어짐)")).toBeDefined();

    act(() => {
      probeHandler?.({ kind: "hop", distance: 4, durationMs: 29, targetY: 300, ledge: "hop" });
    });
    expect(screen.getByText("일반 낙하 (4pt 홉)")).toBeDefined();
    vi.useRealTimers();
  });
});
