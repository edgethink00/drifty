// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PET_MODE_SIT_VARIANT_STORAGE_KEY } from "./petModeSitVariant";
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
  getNativePetQuickControlsState: vi.fn().mockResolvedValue(null),
  listenToNativePetQuickControlsState: vi.fn().mockResolvedValue(vi.fn()),
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
  listenToNativePetQuickControlsAction: vi.fn().mockResolvedValue(vi.fn()),
  listenToNativePetQuickControlsMenuState: vi.fn().mockResolvedValue(vi.fn()),
  isNativePetCursorInside: vi.fn().mockResolvedValue(false),
  setNativePetQuickControlsVisible: vi.fn().mockResolvedValue(undefined),
  moveNativePetToTarget: vi.fn().mockResolvedValue({
    facing: "right",
    targetKind: "browser_tab_close",
    motionOutcome: "completed",
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

describe("pet sit pose", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    bridge.eventHandler = null;
  });

  it("keeps the legacy shipped fallback as one connected vector with its own blink", async () => {
    window.localStorage.setItem(PET_MODE_SIT_VARIANT_STORAGE_KEY, "shipped");
    vi.useFakeTimers();
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sit" });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    expect(cat.getAttribute("data-phase")).toBe("sit");
    expect(cat.getAttribute("data-sit-artwork")).toBe("shipped");

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

  it("uses the approved D frame unchanged when the Dev lab selects it", async () => {
    window.localStorage.setItem(PET_MODE_SIT_VARIANT_STORAGE_KEY, "d-lifted-tail");
    vi.useFakeTimers();
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sit" });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    const pose = cat.querySelector(".pet-mode-cat__sit-reference");
    expect(cat.classList.contains("is-source-locked-sit")).toBe(true);
    expect(pose?.tagName).toBe("IMG");
    expect(pose?.getAttribute("src")).toBe("/pet-mode/sit-reference/d-lifted-tail.png");
    expect(pose?.getAttribute("style")).toContain("--pet-sit-reference-offset-y: 3px");
    expect(pose?.classList.contains("pet-mode-cat__vector")).toBe(false);
  });

  it("keeps D's approved open eyes as a live, coat-aware layer", async () => {
    window.localStorage.setItem(PET_MODE_SIT_VARIANT_STORAGE_KEY, "d-lifted-tail-live");
    vi.useFakeTimers();
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sit" });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    const pose = cat.querySelector(".pet-mode-cat__d-live-neutral");
    const body = cat.querySelector(".pet-mode-cat__d-live-body");
    const eyeLayer = cat.querySelector(".pet-mode-cat__d-live-eyes");
    const eyes = eyeLayer?.querySelector(".pet-mode-cat__d-live-eyes-art");
    expect(cat.classList.contains("is-source-locked-sit")).toBe(false);
    expect(cat.classList.contains("is-d-live-neutral")).toBe(true);
    expect(cat.getAttribute("data-sit-artwork")).toBe("d-lifted-tail-live");
    expect(cat.getAttribute("data-region-id")).toBe("sit:d-lifted-tail-live");
    expect(pose?.getAttribute("src")).toBe("/pet-mode/sit-reference/d-lifted-tail-live.png");
    expect(body?.getAttribute("src")).toBe("/pet-mode/sit-reference/d-lifted-tail-live-no-eyes.png");
    expect(eyes?.getAttribute("src")).toBe("/pet-mode/sit-reference/d-lifted-tail-eyes.png");
    expect(eyeLayer?.getAttribute("style")).toContain("--pet-sit-reference-offset-y: 3px");
    expect(eyeLayer?.getAttribute("style")).toContain("--pet-d-live-gaze-x: 0.00px");
    expect(eyeLayer?.querySelectorAll(".pet-mode-cat__d-live-blink-eye")).toHaveLength(2);
    expect(cat.querySelector(".pet-mode-cat__d-live-closed-eyes")).toBeNull();
  });

  it("keeps D as one approved bitmap at rest, then switches layers only for a blink", async () => {
    window.localStorage.setItem(PET_MODE_SIT_VARIANT_STORAGE_KEY, "d-lifted-tail-live");
    vi.useFakeTimers();
    render(<PetModeWindowApp />);
    await act(async () => undefined);

    act(() => {
      bridge.eventHandler?.({ kind: "preview_action", action: "sit" });
    });
    await act(async () => { await Promise.resolve(); });

    const cat = screen.getByLabelText("Drifty pet cat");
    const neutral = cat.querySelector(".pet-mode-cat__d-live-neutral");
    const body = cat.querySelector(".pet-mode-cat__d-live-body");
    const eyes = cat.querySelector(".pet-mode-cat__d-live-eyes");
    expect(neutral?.classList.contains("is-hidden")).toBe(false);
    expect(body?.classList.contains("is-visible")).toBe(false);
    expect(eyes?.classList.contains("is-visible")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(neutral?.classList.contains("is-hidden")).toBe(true);
    expect(body?.classList.contains("is-visible")).toBe(true);
    expect(eyes?.classList.contains("is-visible")).toBe(true);
    expect(eyes?.classList.contains("is-blinking")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(neutral?.classList.contains("is-hidden")).toBe(false);
    expect(body?.classList.contains("is-visible")).toBe(false);
    expect(eyes?.classList.contains("is-visible")).toBe(false);
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
