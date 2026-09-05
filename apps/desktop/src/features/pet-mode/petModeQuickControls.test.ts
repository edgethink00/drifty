import { describe, expect, it } from "vitest";
import {
  EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT,
  PET_QUICK_CONTROLS_GAP,
  PET_QUICK_CONTROLS_HEIGHT,
  PET_QUICK_CONTROLS_HOVER_CLOSE_MS,
  PET_QUICK_CONTROLS_HOVER_OPEN_MS,
  PET_QUICK_CONTROLS_ACKNOWLEDGE_COOLDOWN_MS,
  PET_QUICK_CONTROLS_ACKNOWLEDGE_MS,
  PET_QUICK_CONTROLS_INTERACTION_COOLDOWN_MS,
  PET_QUICK_CONTROLS_STATE_CONFIRMATION_TIMEOUT_MS,
  isPetQuickControlsHoverablePhase,
  PET_QUICK_CONTROLS_WIDTH,
  advancePetQuickControlsHoverIntent,
  isPetQuickControlsInteractionCoolingDown,
  layoutPetQuickControls,
  pointerMovedEnough,
} from "./petModeQuickControls";

describe("pointerMovedEnough", () => {
  it("uses the first sample as a stationary baseline", () => {
    expect(pointerMovedEnough(null, { x: 10, y: 10 })).toBe(false);
  });

  it("ignores sub-pixel jitter under the stationary threshold", () => {
    expect(pointerMovedEnough({ x: 10, y: 10 }, { x: 10.5, y: 10.5 })).toBe(false);
  });
});

describe("pet interaction cooldown", () => {
  it("suppresses controls for the configured 670ms after interaction", () => {
    expect(PET_QUICK_CONTROLS_INTERACTION_COOLDOWN_MS).toBe(670);
    expect(PET_QUICK_CONTROLS_ACKNOWLEDGE_MS).toBe(1_100);
    expect(PET_QUICK_CONTROLS_ACKNOWLEDGE_COOLDOWN_MS).toBe(1_200);
    expect(PET_QUICK_CONTROLS_STATE_CONFIRMATION_TIMEOUT_MS).toBe(3_000);
    expect(isPetQuickControlsInteractionCoolingDown(1_670, 1_669)).toBe(true);
    expect(isPetQuickControlsInteractionCoolingDown(1_670, 1_670)).toBe(false);
  });
});

describe("advancePetQuickControlsHoverIntent", () => {
  it("keeps a roaming cat hoverable so the bar is reachable during autonomous walks", () => {
    // Regression: gait was excluded from the hoverable set, and because the pet
    // roams on its own for long stretches, a live hover over a walking cat
    // never opened the bar at all.
    for (const phase of ["walk", "idle", "sit", "blink", "sleep", "happy", "tail", "drowsy", "stretch", "paw"]) {
      expect(isPetQuickControlsHoverablePhase(phase), phase).toBe(true);
    }
  });

  it("suppresses the hover while the pointer is already committed elsewhere", () => {
    // `notice` opens the drift-hunt sequence, so the cat is already committed
    // to its own action before the stalk begins.
    for (const phase of ["drag", "release", "entry", "anger", "notice", "stalk", "bite", "return", "run"]) {
      expect(isPetQuickControlsHoverablePhase(phase), phase).toBe(false);
    }
  });

  it("uses a deliberate 220ms dwell before opening", () => {
    expect(PET_QUICK_CONTROLS_HOVER_OPEN_MS).toBe(220);
  });

  it("uses the configured 250ms leave grace", () => {
    expect(PET_QUICK_CONTROLS_HOVER_CLOSE_MS).toBe(250);
  });

  it("opens only after a dwell on a moving pointer", () => {
    let state = EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT;
    state = advancePetQuickControlsHoverIntent(state, {
      pointerOverPet: true,
      pointerOverControls: false,
      pointerMoved: true,
      blocked: false,
    }, PET_QUICK_CONTROLS_HOVER_OPEN_MS - 1);
    expect(state.open).toBe(false);

    state = advancePetQuickControlsHoverIntent(state, {
      pointerOverPet: true,
      pointerOverControls: false,
      pointerMoved: true,
      blocked: false,
    }, 1);
    expect(state.open).toBe(true);
  });

  it("keeps counting after the pointer enters and comes to rest", () => {
    let state = EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT;
    state = advancePetQuickControlsHoverIntent(state, {
      pointerOverPet: true,
      pointerOverControls: false,
      pointerMoved: true,
      blocked: false,
    }, 80);
    state = advancePetQuickControlsHoverIntent(state, {
      pointerOverPet: true,
      pointerOverControls: false,
      pointerMoved: false,
      blocked: false,
    }, 80);
    expect(state.open).toBe(false);

    state = advancePetQuickControlsHoverIntent(state, {
      pointerOverPet: true,
      pointerOverControls: false,
      pointerMoved: false,
      blocked: false,
    }, PET_QUICK_CONTROLS_HOVER_OPEN_MS - 160 - 1);
    expect(state.open).toBe(false);

    state = advancePetQuickControlsHoverIntent(state, {
      pointerOverPet: true,
      pointerOverControls: false,
      pointerMoved: false,
      blocked: false,
    }, 1);
    expect(state.open).toBe(true);
  });

  it("rearms a stationary hover after a direct interaction", () => {
    let state = advancePetQuickControlsHoverIntent(EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT, {
      pointerOverPet: true,
      pointerOverControls: false,
      pointerMoved: false,
      resumeAfterInteraction: true,
      blocked: false,
    }, 80);
    expect(state.open).toBe(false);

    state = advancePetQuickControlsHoverIntent(state, {
      pointerOverPet: true,
      pointerOverControls: false,
      pointerMoved: false,
      blocked: false,
    }, PET_QUICK_CONTROLS_HOVER_OPEN_MS - 80);
    expect(state.open).toBe(true);
  });

  it("does not open when the cat walks under a stationary cursor", () => {
    const state = advancePetQuickControlsHoverIntent(EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT, {
      pointerOverPet: true,
      pointerOverControls: false,
      pointerMoved: false,
      blocked: false,
    }, PET_QUICK_CONTROLS_HOVER_OPEN_MS);
    expect(state).toEqual(EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT);
  });

  it("keeps the bar open while crossing into the controls", () => {
    const open = {
      open: true,
      openElapsedMs: PET_QUICK_CONTROLS_HOVER_OPEN_MS,
      closeElapsedMs: 0,
    };
    const state = advancePetQuickControlsHoverIntent(open, {
      pointerOverPet: false,
      pointerOverControls: true,
      pointerMoved: false,
      blocked: false,
    }, 80);
    expect(state.open).toBe(true);
    expect(state.closeElapsedMs).toBe(0);
  });

  it("closes after leaving both the cat and the bar", () => {
    const open = {
      open: true,
      openElapsedMs: PET_QUICK_CONTROLS_HOVER_OPEN_MS,
      closeElapsedMs: 0,
    };
    const waiting = advancePetQuickControlsHoverIntent(open, {
      pointerOverPet: false,
      pointerOverControls: false,
      pointerMoved: true,
      blocked: false,
    }, PET_QUICK_CONTROLS_HOVER_CLOSE_MS - 1);
    expect(waiting.open).toBe(true);

    const closed = advancePetQuickControlsHoverIntent(waiting, {
      pointerOverPet: false,
      pointerOverControls: false,
      pointerMoved: true,
      blocked: false,
    }, 1);
    expect(closed).toEqual(EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT);
  });

  it("collapses immediately while blocked", () => {
    const open = {
      open: true,
      openElapsedMs: PET_QUICK_CONTROLS_HOVER_OPEN_MS,
      closeElapsedMs: 0,
    };
    expect(advancePetQuickControlsHoverIntent(open, {
      pointerOverPet: true,
      pointerOverControls: false,
      pointerMoved: true,
      blocked: true,
    }, 16)).toEqual(EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT);
  });
});

it("opens from the controls even if the pointer is stationary", () => {
    const state = advancePetQuickControlsHoverIntent(EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT, {
      pointerOverPet: false,
      pointerOverControls: true,
      pointerMoved: false,
      blocked: false,
    }, PET_QUICK_CONTROLS_HOVER_OPEN_MS);
    expect(state.open).toBe(true);
  });

describe("layoutPetQuickControls", () => {
  const workArea = { x: 0, y: 0, width: 1440, height: 900 };

  it("places the bar below a top-resident cat", () => {
    const layout = layoutPetQuickControls({
      pet: { x: 1200, y: 14, width: 144, height: 99 },
      workArea,
    });
    expect(layout.placement).toBe("below");
    expect(layout.y).toBe(14 + 99 + PET_QUICK_CONTROLS_GAP);
    expect(layout.width).toBe(PET_QUICK_CONTROLS_WIDTH);
    expect(layout.height).toBe(PET_QUICK_CONTROLS_HEIGHT);
    expect(layout.x + layout.width).toBeLessThanOrEqual(workArea.width - 8);
  });

  it("flips above when the cat sits near the bottom edge", () => {
    const layout = layoutPetQuickControls({
      pet: { x: 200, y: 860, width: 144, height: 99 },
      workArea,
    });
    expect(layout.placement).toBe("above");
    expect(layout.y).toBe(860 - PET_QUICK_CONTROLS_HEIGHT - PET_QUICK_CONTROLS_GAP);
  });
});
