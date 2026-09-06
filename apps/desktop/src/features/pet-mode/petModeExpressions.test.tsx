// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetModeWindowApp } from "./PetModeWindowApp";
import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";
import {
  PET_MODE_PET_STREAK_TO_SLEEP,
  PET_MODE_PET_STREAK_WINDOW_MS,
  PET_MODE_STORAGE_KEY,
  type PetModeWindowEvent,
} from "./petModeData";

const bridge = vi.hoisted(() => ({
  eventHandler: null as ((event: PetModeWindowEvent) => void) | null,
  beginNativePetDrag: vi.fn().mockResolvedValue({ moved: false, startX: 0, startY: 0, endX: 0, endY: 0 }),
  moveNativePetToTarget: vi.fn().mockResolvedValue({
    facing: "right",
    targetKind: "window_close",
    motionOutcome: "completed",
    confidence: "high",
    diagnostic: "test",
    targetX: 0,
    targetY: 0,
  }),
  returnNativePetHome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./petModeBridge", () => ({
  getNativePetQuickControlsState: vi.fn().mockResolvedValue(null),
  listenToNativePetQuickControlsState: vi.fn().mockResolvedValue(vi.fn()),
  alignNativePetContact: vi.fn().mockResolvedValue(undefined),
  beginNativePetDrag: bridge.beginNativePetDrag,
  cancelNativePetMotion: vi.fn().mockResolvedValue(undefined),
  listenToNativePetDragEnd: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetDragStart: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetStrokeDetected: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetDragProbe: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetModeEvent: vi.fn().mockImplementation(async (handler: (event: PetModeWindowEvent) => void) => {
    bridge.eventHandler = handler;
    return vi.fn();
  }),
  listenToNativePetModeLabStateRequest: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetQuickControlsAction: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetQuickControlsMenuState: vi.fn().mockResolvedValue(vi.fn()),
  isNativePetCursorInside: vi.fn().mockResolvedValue(false),
  setNativePetQuickControlsVisible: vi.fn().mockResolvedValue(undefined),
  moveNativePetToTarget: bridge.moveNativePetToTarget,
  finishNativePetFullscreenIntervention: vi.fn().mockResolvedValue(false),
  reportNativePetContact: vi.fn().mockResolvedValue(undefined),
  reportNativePetDragError: vi.fn().mockResolvedValue(undefined),
  reportNativePetModeLabState: vi.fn().mockResolvedValue(undefined),
  reportNativePetPointer: vi.fn().mockResolvedValue(undefined),
  returnNativePetHome: bridge.returnNativePetHome,
  exitNativePetScreen: vi.fn().mockResolvedValue("left"),
  returnNativePetFromOuting: vi.fn().mockResolvedValue(undefined),
  roamNativePet: vi.fn().mockResolvedValue(undefined),
  sampleNativePetCursor: vi.fn().mockResolvedValue(null),
  reconcileNativePetPosition: vi.fn().mockResolvedValue({ x: 0, y: 0, moved: false, reason: "no_control_overlap" }),
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
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");
    // A preview-era OFF value may remain on disk, but it no longer gates any
    // of the four promoted relationship beats.
    window.localStorage.setItem("drifty.dev.petModeExperiments.v1", "0");
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
      motionOutcome: "completed",
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

  it("wears the proud lids while returning from every successful real close", async () => {
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
          id: "production-close",
          appName: "Distracting app",
          browserName: null,
          preview: false,
          labTarget: null,
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
        motionOutcome: "completed",
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

  it("stays happy for three pets, gets drowsy on the fourth, then sleeps on the fifth", async () => {
    vi.useFakeTimers();
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    for (let interaction = 1; interaction <= 3; interaction += 1) {
      petOnce();
      await act(async () => { await Promise.resolve(); });
      expect(phase(), `interaction ${interaction}`).toBe("happy");
    }

    petOnce();
    await act(async () => { await Promise.resolve(); });
    expect(phase(), "interaction 4").toBe("drowsy");

    petOnce();
    await act(async () => { await Promise.resolve(); });
    expect(phase(), "interaction 5").toBe("sleep");
  });

  it("counts each recognized stroke as one interaction", async () => {
    for (let interaction = 1; interaction <= 5; interaction += 1) {
      bridge.beginNativePetDrag.mockResolvedValueOnce({
        moved: false,
        strokeDetected: true,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
      });
    }
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    for (let interaction = 1; interaction <= 3; interaction += 1) {
      petOnce();
      await waitFor(() => {
        expect(phase(), `stroke ${interaction}`).toBe("happy");
      });
    }

    petOnce();
    await waitFor(() => {
      expect(phase(), "stroke 4").toBe("drowsy");
    });

    petOnce();
    await waitFor(() => {
      expect(phase(), "stroke 5").toBe("sleep");
    });
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
