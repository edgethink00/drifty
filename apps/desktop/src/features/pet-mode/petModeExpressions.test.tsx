// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetModeWindowApp } from "./PetModeWindowApp";
import {
  PET_MODE_PET_STREAK_TO_SLEEP,
  PET_MODE_PET_STREAK_WINDOW_MS,
  PET_MODE_STORAGE_KEY,
  type PetModeWindowEvent,
} from "./petModeData";

const bridge = vi.hoisted(() => ({
  eventHandler: null as ((event: PetModeWindowEvent) => void) | null,
  moveNativePetToTarget: vi.fn().mockResolvedValue({
    facing: "right",
    targetKind: "window_close",
    confidence: "high",
    diagnostic: "test",
    targetX: 0,
    targetY: 0,
  }),
  returnNativePetHome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./petModeBridge", () => ({
  alignNativePetContact: vi.fn().mockResolvedValue(undefined),
  beginNativePetDrag: vi.fn().mockResolvedValue({ moved: false, startX: 0, startY: 0, endX: 0, endY: 0 }),
  cancelNativePetMotion: vi.fn().mockResolvedValue(undefined),
  listenToNativePetDragEnd: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetDragStart: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetDragProbe: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetModeEvent: vi.fn().mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
    bridge.eventHandler = handler;
    return vi.fn();
  }),
  listenToNativePetModeLabStateRequest: vi.fn().mockResolvedValue(vi.fn()),
  moveNativePetToTarget: bridge.moveNativePetToTarget,
  reportNativePetContact: vi.fn().mockResolvedValue(undefined),
  reportNativePetDragError: vi.fn().mockResolvedValue(undefined),
  reportNativePetModeLabState: vi.fn().mockResolvedValue(undefined),
  reportNativePetPointer: vi.fn().mockResolvedValue(undefined),
  returnNativePetHome: bridge.returnNativePetHome,
  exitNativePetScreen: vi.fn().mockResolvedValue("left"),
  returnNativePetFromOuting: vi.fn().mockResolvedValue(undefined),
  roamNativePet: vi.fn().mockResolvedValue(undefined),
  sampleNativePetCursor: vi.fn().mockResolvedValue(null),
  rememberNativePetPosition: vi.fn().mockResolvedValue(undefined),
  resolveNativePetDrop: vi.fn().mockResolvedValue(null),
  setNativePetPresence: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./petModeHitRegions", () => ({
  preloadPetModeHitRegions: vi.fn().mockResolvedValue(undefined),
  publishPetModeHitRegion: vi.fn().mockResolvedValue(undefined),
  stagePetModeHitRegionTransition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onMoved: vi.fn().mockResolvedValue(vi.fn()) }),
}));

const HIT_TARGET = "Pet Drifty cat. Drag to move. Right-click for options.";

function petOnce() {
  fireEvent.pointerDown(screen.getByRole("button", { name: HIT_TARGET }), { clientX: 72, clientY: 60 });
}

function phase() {
  return screen.getByLabelText("Drifty pet cat").getAttribute("data-phase");
}

describe("pet expressions", () => {
  beforeEach(() => {
    // The window reads its enabled state from storage on mount.
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    // The walk vector only renders once its frames resolve, and the proud lids
    // live inside that vector.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames: ["M0 0 L1 1"], cycleSeconds: 1 }),
    }));
    vi.stubGlobal("Image", class {
      src = "";
      decode() { return Promise.resolve(); }
    });
    // Reduced motion skips the launch entry and compresses the paw timeline,
    // keeping the state boundary under test deterministic.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    bridge.moveNativePetToTarget.mockResolvedValue({
      facing: "right",
      targetKind: "window_close",
      confidence: "high",
      diagnostic: "test",
      targetX: 0,
      targetY: 0,
    });
    bridge.returnNativePetHome.mockResolvedValue(undefined);
    bridge.eventHandler = null;
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("wears the proud lids only while returning from a successful Drifty-window close", async () => {
    vi.useFakeTimers();
    let finishReturn!: () => void;
    bridge.returnNativePetHome.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishReturn = resolve;
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drifty-window-close",
          appName: "Drifty",
          browserName: null,
          preview: false,
          labTarget: "drifty_window_x",
        },
      });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(240); });

    expect(bridge.returnNativePetHome).toHaveBeenCalledTimes(1);
    expect(phase()).toBe("walk");
    expect(document.querySelector(".pet-mode-cat__walk-eyes--proud")).not.toBeNull();

    await act(async () => {
      finishReturn();
      await Promise.resolve();
    });
    expect(phase()).toBe("idle");
    expect(document.querySelector(".pet-mode-cat__walk-eyes--proud")).toBeNull();
  });

  it("keeps the neutral face while approaching Drifty and during other walks", async () => {
    vi.useFakeTimers();
    let finishMove!: () => void;
    bridge.moveNativePetToTarget.mockImplementationOnce(() => new Promise((resolve) => {
      finishMove = () => resolve({
        facing: "right",
        targetKind: "window_close",
        confidence: "high",
        diagnostic: "test",
        targetX: 0,
        targetY: 0,
      });
    }));
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({
        kind: "intervention",
        target: {
          id: "drifty-window-approach",
          appName: "Drifty",
          browserName: null,
          preview: false,
          labTarget: "drifty_window_x",
        },
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(phase()).toBe("run");
    expect(document.querySelector(".pet-mode-cat__walk-eyes--proud")).toBeNull();

    await act(async () => { finishMove(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(240); });
    expect(phase()).toBe("idle");
    expect(document.querySelector(".pet-mode-cat__walk-eyes--proud")).toBeNull();
  });

  it("settles the cat into sleep after a run of pets", async () => {
    vi.useFakeTimers();
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    for (let i = 0; i < PET_MODE_PET_STREAK_TO_SLEEP; i += 1) {
      petOnce();
      await act(async () => { await Promise.resolve(); });
    }

    expect(phase()).toBe("sleep");
  });

  it("does not settle when the pets are spaced beyond the streak window", async () => {
    vi.useFakeTimers();
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    for (let i = 0; i < PET_MODE_PET_STREAK_TO_SLEEP + 2; i += 1) {
      petOnce();
      await act(async () => { await Promise.resolve(); });
      // Let the streak lapse between touches: occasional attention should stay
      // a happy beat instead of accumulating into a nap.
      await act(async () => {
        vi.advanceTimersByTime(PET_MODE_PET_STREAK_WINDOW_MS + 500);
        await Promise.resolve();
      });
    }

    expect(phase()).not.toBe("sleep");
  });

  it("ships the anger mark with the same halo and beat as the alert", async () => {
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    // The mark stays mounted so the sleeping wake-up reaction can reveal it
    // without swapping or loading artwork at interaction time.
    const anger = document.querySelector(".pet-mode-cat__anger");
    expect(anger).not.toBeNull();
    expect(anger?.querySelector("path")?.getAttribute("d")).toMatch(/^M736\.8 103\.4/);
  });

  it("ships the approved V06 music note as vector artwork", async () => {
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    const note = document.querySelector(".pet-mode-cat__music-note");
    expect(note).not.toBeNull();
    expect(note?.querySelector("ellipse")?.getAttribute("cx")).toBe("732");
    expect(note?.querySelector("path")?.getAttribute("d")).toBe("M747 154 V111 L777 120");
  });
});
