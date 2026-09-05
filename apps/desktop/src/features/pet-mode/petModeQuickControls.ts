export const PET_QUICK_CONTROLS_WINDOW_LABEL = "pet-quick-controls";

// Korean production width. The native host expands the English surface to
// 300pt when it receives the localized quick-control state.
export const PET_QUICK_CONTROLS_WIDTH = 273;
export const PET_QUICK_CONTROLS_HEIGHT = 36;
export const PET_QUICK_CONTROLS_GAP = 8;
export const PET_QUICK_CONTROLS_SCREEN_INSET = 8;
export const PET_QUICK_CONTROLS_HOVER_OPEN_MS = 220;
// The bar sits one 8pt gap from the cat. A quarter-second grace covers both
// that crossing and small accidental exits without making dismissal feel slow.
export const PET_QUICK_CONTROLS_HOVER_CLOSE_MS = 250;
export const PET_QUICK_CONTROLS_POLL_MS = 80;
export const PET_QUICK_CONTROLS_STATIONARY_MOVE_PX = 2;
export const PET_QUICK_CONTROLS_INTERACTION_COOLDOWN_MS = 670;
export const PET_QUICK_CONTROLS_ACKNOWLEDGE_MS = 1_100;
export const PET_QUICK_CONTROLS_ACKNOWLEDGE_COOLDOWN_MS = 1_200;
export const PET_QUICK_CONTROLS_STATE_CONFIRMATION_TIMEOUT_MS = 3_000;

/**
 * Poses during which a hover may open the quick controls.
 *
 * The cat is a moving target by design: it roams on its own for long
 * stretches, so gait poses have to stay hoverable or the bar can never open
 * while the pet is walking. Only poses where the pointer is already committed
 * to something else (a drag, a drop, a chase, the entrance, an angry wake)
 * suppress it.
 */
const PET_QUICK_CONTROLS_NON_HOVERABLE_PHASES = new Set([
  "drag",
  "release",
  "entry",
  "anger",
  "notice",
  "stalk",
  "bite",
  "return",
  "run",
]);

export function isPetQuickControlsHoverablePhase(phase: string): boolean {
  return !PET_QUICK_CONTROLS_NON_HOVERABLE_PHASES.has(phase);
}

export type PetQuickControlsPlacement = "below" | "above";

export type PetQuickControlsRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type PetQuickControlsPoint = {
  readonly x: number;
  readonly y: number;
};

export type PetQuickControlsLayout = PetQuickControlsRect & {
  readonly placement: PetQuickControlsPlacement;
};

export type PetQuickControlsHoverIntentInput = {
  readonly pointerOverPet: boolean;
  readonly pointerOverControls: boolean;
  readonly pointerMoved: boolean;
  readonly resumeAfterInteraction?: boolean;
  readonly blocked: boolean;
};

export type PetQuickControlsHoverIntentState = {
  readonly open: boolean;
  readonly openElapsedMs: number;
  readonly closeElapsedMs: number;
};

export const EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT: PetQuickControlsHoverIntentState = {
  open: false,
  openElapsedMs: 0,
  closeElapsedMs: 0,
};

export function pointerMovedEnough(
  previous: PetQuickControlsPoint | null,
  next: PetQuickControlsPoint,
  thresholdPx = PET_QUICK_CONTROLS_STATIONARY_MOVE_PX,
): boolean {
  // The first sample establishes a baseline. Treating it as movement makes a
  // stationary cursor look intentional when the cat happens to walk under it.
  if (!previous) return false;
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  return Math.hypot(dx, dy) >= thresholdPx;
}

export function isPetQuickControlsInteractionCoolingDown(
  blockedUntilMs: number,
  nowMs: number,
): boolean {
  return nowMs < blockedUntilMs;
}

export function advancePetQuickControlsHoverIntent(
  current: PetQuickControlsHoverIntentState,
  input: PetQuickControlsHoverIntentInput,
  elapsedMs: number,
): PetQuickControlsHoverIntentState {
  if (input.blocked) {
    return EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT;
  }

  const hovering = input.pointerOverPet || input.pointerOverControls;
  if (!hovering) {
    if (!current.open) return EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT;
    const closeElapsedMs = current.closeElapsedMs + elapsedMs;
    if (closeElapsedMs >= PET_QUICK_CONTROLS_HOVER_CLOSE_MS) {
      return EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT;
    }
    return {
      open: true,
      openElapsedMs: current.openElapsedMs,
      closeElapsedMs,
    };
  }

  if (current.open) {
    return {
      open: true,
      openElapsedMs: current.openElapsedMs,
      closeElapsedMs: 0,
    };
  }

  // Once a real pointer movement starts the dwell, keep counting while the
  // pointer rests over the cat. Requiring movement on every poll turns dwell
  // into a hidden "keep jiggling the mouse" gesture.
  const dwellArmed = current.openElapsedMs > 0
    || input.pointerMoved
    || input.resumeAfterInteraction === true
    || input.pointerOverControls;
  if (!dwellArmed) {
    return EMPTY_PET_QUICK_CONTROLS_HOVER_INTENT;
  }

  const openElapsedMs = current.openElapsedMs + elapsedMs;
  if (openElapsedMs >= PET_QUICK_CONTROLS_HOVER_OPEN_MS) {
    return {
      open: true,
      openElapsedMs,
      closeElapsedMs: 0,
    };
  }
  return {
    open: false,
    openElapsedMs,
    closeElapsedMs: 0,
  };
}

export function layoutPetQuickControls(input: {
  readonly pet: PetQuickControlsRect;
  readonly workArea: PetQuickControlsRect;
}): PetQuickControlsLayout {
  const centeredX = input.pet.x + (input.pet.width - PET_QUICK_CONTROLS_WIDTH) / 2;
  const minX = input.workArea.x + PET_QUICK_CONTROLS_SCREEN_INSET;
  const maxX = input.workArea.x + input.workArea.width - PET_QUICK_CONTROLS_WIDTH - PET_QUICK_CONTROLS_SCREEN_INSET;
  const x = clamp(centeredX, minX, Math.max(minX, maxX));

  const belowY = input.pet.y + input.pet.height + PET_QUICK_CONTROLS_GAP;
  const aboveY = input.pet.y - PET_QUICK_CONTROLS_HEIGHT - PET_QUICK_CONTROLS_GAP;
  const minY = input.workArea.y + PET_QUICK_CONTROLS_SCREEN_INSET;
  const maxY = input.workArea.y + input.workArea.height - PET_QUICK_CONTROLS_HEIGHT - PET_QUICK_CONTROLS_SCREEN_INSET;
  const fitsBelow = belowY <= maxY;
  const fitsAbove = aboveY >= minY;
  const placement: PetQuickControlsPlacement = fitsBelow || !fitsAbove ? "below" : "above";
  const unclampedY = placement === "below" ? belowY : aboveY;
  const y = clamp(unclampedY, minY, Math.max(minY, maxY));

  return {
    x,
    y,
    width: PET_QUICK_CONTROLS_WIDTH,
    height: PET_QUICK_CONTROLS_HEIGHT,
    placement,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
