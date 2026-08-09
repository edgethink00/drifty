// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PetModeWindowApp } from "./PetModeWindowApp";
import {
  PET_MODE_BLINK_DURATION_MS,
  PET_MODE_DRAG_PICKUP_MS,
  PET_MODE_DRAG_SETTLE_MS,
  PET_MODE_LIFE_MOTION_DURATION_MS,
  PET_MODE_STORAGE_KEY,
  PET_MODE_TAIL_FLICK_DURATION_MS,
  type PetModeWindowEvent,
} from "./petModeData";

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
  rememberNativePetPosition: vi.fn().mockResolvedValue(undefined),
  setNativePetPresence: vi.fn().mockResolvedValue(undefined),
  setNativePetInteractive: vi.fn().mockResolvedValue(undefined),
  onMoved: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("./petModeBridge", () => ({
  alignNativePetContact: bridge.alignNativePetContact,
  beginNativePetDrag: bridge.beginNativePetDrag,
  cancelNativePetMotion: bridge.cancelNativePetMotion,
  listenToNativePetDragEnd: bridge.listenToNativePetDragEnd,
  listenToNativePetDragStart: bridge.listenToNativePetDragStart,
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
  rememberNativePetPosition: bridge.rememberNativePetPosition,
  setNativePetPresence: bridge.setNativePetPresence,
  setNativePetInteractive: bridge.setNativePetInteractive,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onMoved: bridge.onMoved }),
}));

describe("PetModeWindowApp", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    bridge.dragEndHandler = null;
    bridge.dragStartHandler = null;
    bridge.eventHandler = null;
    window.localStorage.clear();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.surface;
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
    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move." });
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

  it("renders the dedicated entry gait and settles on the native idle signal", async () => {
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "facing", facing: "left" });
      bridge.eventHandler?.({ kind: "motion", motion: "entry" });
    });
    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("entry");
    expect(cat.classList.contains("is-mirrored")).toBe(true);

    act(() => {
      bridge.eventHandler?.({ kind: "entry_complete" });
    });
    expect(cat.getAttribute("data-phase")).toBe("idle");
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

    act(() => { vi.advanceTimersByTime(921); });
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

    act(() => { vi.advanceTimersByTime(800); });
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

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move." });
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

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move." });
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

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move." });
    dispatchPointer(pet, "pointerdown", { pointerId: 32, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 32, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sleep");

    dispatchPointer(pet, "pointerdown", { pointerId: 33, clientX: 12, clientY: 12 });
    dispatchPointer(pet, "pointerup", { pointerId: 33, clientX: 12, clientY: 12 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("idle");
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

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move." });
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

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move." });
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

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move." });
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

    const pet = screen.getByRole("button", { name: "Pet Drifty cat. Drag to move." });
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

  it("owns its compact native input surface immediately so the first press cannot click through", async () => {
    bridge.listenToNativePetModeEvent.mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
      bridge.eventHandler = handler;
      return vi.fn();
    });
    render(<PetModeWindowApp />);
    await act(async () => { await Promise.resolve(); });

    expect(bridge.setNativePetInteractive).toHaveBeenCalledWith(true);
  });
});
