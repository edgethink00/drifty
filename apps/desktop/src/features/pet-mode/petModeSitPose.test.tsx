// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PetModeWindowApp } from "./PetModeWindowApp";
import {
  PET_MODE_SIT_MIN_MS,
  pickPetModeLifeAction,
  type PetModeWindowEvent,
} from "./petModeData";

const bridge = vi.hoisted(() => ({
  eventHandler: null as ((event: PetModeWindowEvent) => void) | null,
}));

vi.mock("./petModeBridge", () => ({
  alignNativePetContact: vi.fn().mockResolvedValue(undefined),
  beginNativePetDrag: vi.fn().mockResolvedValue({ moved: false, startX: 0, startY: 0, endX: 0, endY: 0 }),
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
  moveNativePetToTarget: vi.fn().mockResolvedValue({
    facing: "right",
    targetKind: "browser_tab_close",
    confidence: "high",
    diagnostic: "test",
    targetX: 0,
    targetY: 0,
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

describe("pet sit pose", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    bridge.eventHandler = null;
  });

  it("renders the sit silhouette as one connected vector with its own blink", async () => {
    vi.useFakeTimers();
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sit" });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("sit");

    // The pose must be vector like sleep, not a raster swap: a bitmap would
    // ignore the coat token and reintroduce the decode flash the walk/paw
    // frames were preloaded to avoid.
    const pose = cat.querySelector(".pet-mode-cat__sit-pose");
    expect(pose).not.toBeNull();
    expect(pose?.querySelectorAll("path").length).toBeGreaterThan(0);

    // Sitting is held for minutes, so it carries its own eye animation rather
    // than relying on the blink scheduler, which would swap in the standing
    // sprite and snap the pose.
    // The sit reuses both shipped walk eyes instead of redrawing a one-eye or
    // front-facing expression for this pose.
    expect(pose?.querySelectorAll(".pet-mode-cat__sit-eye-open")).toHaveLength(2);
    expect(pose?.querySelector('circle[cx="120.4"][cy="46.2"][r="2.2"]')).not.toBeNull();
    expect(pose?.querySelector('circle[cx="140.3"][cy="46.2"][r="2.2"]')).not.toBeNull();
    expect(pose?.querySelector(".pet-mode-cat__sit-eye-closed")).not.toBeNull();
  });

  it("keeps a sitting cat pettable instead of ignoring the touch", async () => {
    vi.useFakeTimers();
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sit" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("sit");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Pet Drifty cat. Drag to move. Right-click for options." }), {
      clientX: 72,
      clientY: 60,
    });
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByLabelText("Drifty pet cat").getAttribute("data-phase")).toBe("happy");
  });

  it("makes sleep the likely continuation of a sit and unlikely from standing", () => {
    const sample = (posture: "standing" | "sitting") => {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 1000; i += 1) {
        const action = pickPetModeLifeAction(posture, i / 1000);
        counts[action] = (counts[action] ?? 0) + 1;
      }
      return counts;
    };

    const standing = sample("standing");
    const sitting = sample("sitting");

    // From standing the cat settles rather than dropping straight to sleep.
    expect(standing.sit).toBeGreaterThan(standing.sleep);
    // Once settled, dozing off dominates every other continuation.
    expect(sitting.sleep).toBeGreaterThan(sitting.walk + sitting.stretch);
    // A settled cat is likelier to stay put than to get up and walk, which is
    // what keeps the sit pose on screen instead of collapsing back to standing.
    expect(sitting.sit).toBeGreaterThan(sitting.walk);
    // Sleep is the single most likely continuation of a sit.
    expect(sitting.sleep).toBeGreaterThan(sitting.sit);
  });

  it("holds a sit long enough to read as a rest, not a twitch", () => {
    expect(PET_MODE_SIT_MIN_MS).toBeGreaterThanOrEqual(60_000);
  });
});
