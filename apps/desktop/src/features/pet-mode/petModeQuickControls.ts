export const PET_QUICK_CONTROLS_WINDOW_LABEL = "pet-quick-controls";

// Korean resting width. The panel is sized to its content, so the native host
// widens this surface when it receives the localized quick-control state
// (English resting) and again while auto-close is paused, because that state
// spells out when the pause lifts.
export const PET_QUICK_CONTROLS_WIDTH = 255;
export const PET_QUICK_CONTROLS_HEIGHT = 36;
export const PET_QUICK_CONTROLS_GAP = 8;
export const PET_QUICK_CONTROLS_SCREEN_INSET = 8;
export const PET_QUICK_CONTROLS_ACKNOWLEDGE_MS = 1_100;
export const PET_QUICK_CONTROLS_STATE_CONFIRMATION_TIMEOUT_MS = 3_000;

export type PetQuickControlsPlacement = "below" | "above";

export type PetQuickControlsRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type PetQuickControlsLayout = PetQuickControlsRect & {
  readonly placement: PetQuickControlsPlacement;
};

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
