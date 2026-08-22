export type PetModeGazePose = "idle" | "sit";

export type PetModeGazeSample = {
  readonly cursorX: number;
  readonly cursorY: number;
  readonly windowX: number;
  readonly windowY: number;
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly facing: "left" | "right";
  readonly pose: PetModeGazePose;
  readonly reducedMotion: boolean;
};

export type PetModeGazeOffset = {
  readonly x: number;
  readonly y: number;
};

export const PET_MODE_GAZE_ENGAGE_RADIUS_PX = 80;
export const PET_MODE_GAZE_RELEASE_RADIUS_PX = 110;
export const PET_MODE_GAZE_MAX_OFFSET_PX = 1.52;
export const PET_MODE_GAZE_BODY_MAX_PX = 1.15;
export const PET_MODE_GAZE_SAMPLE_MS = 140;
export const PET_MODE_GAZE_DAMP_MS = 180;

const IDLE_HEAD = { x: 581.294 / 797, y: 254.445 / 581 };
const SIT_HEAD = { x: (120.4 - 12.84) / 150, y: (46.2 - 0.3) / 120 };
const PET_PANEL = { width: 144, height: 99 };
const PET_CAT = { left: 11.4, top: 4.2, width: 121.2, height: 92.4 };

function petModeGazeHead(sample: PetModeGazeSample): { readonly x: number; readonly y: number } {
  const scaleX = sample.windowWidth / PET_PANEL.width;
  const scaleY = sample.windowHeight / PET_PANEL.height;
  const catLeft = sample.windowX + PET_CAT.left * scaleX;
  const catTop = sample.windowY + PET_CAT.top * scaleY;
  const catWidth = PET_CAT.width * scaleX;
  const catHeight = PET_CAT.height * scaleY;
  const head = sample.pose === "sit" ? SIT_HEAD : IDLE_HEAD;
  const localX = sample.facing === "left" ? 1 - head.x : head.x;
  if (sample.pose === "sit") {
    const displayedWidth = catHeight * 150 / 120;
    const letterboxX = (catWidth - displayedWidth) / 2;
    return {
      x: catLeft + letterboxX + displayedWidth * localX,
      y: catTop + catHeight * head.y,
    };
  }
  const displayedHeight = catWidth * 581 / 797;
  const letterboxY = (catHeight - displayedHeight) / 2;
  return {
    x: catLeft + catWidth * localX,
    y: catTop + letterboxY + displayedHeight * head.y,
  };
}

export function petModeGazePoseForPhase(phase: string): PetModeGazePose | null {
  if (phase === "idle" || phase === "sit") {
    return phase;
  }
  return null;
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

export function resolvePetModeGazeOffset(
  sample: PetModeGazeSample,
  engaged: boolean,
): { readonly offset: PetModeGazeOffset; readonly engaged: boolean; readonly distance: number } {
  if (sample.reducedMotion || sample.windowWidth <= 0 || sample.windowHeight <= 0) {
    return { offset: { x: 0, y: 0 }, engaged: false, distance: Number.POSITIVE_INFINITY };
  }

  const head = petModeGazeHead(sample);
  const headX = head.x;
  const headY = head.y;
  const dx = sample.cursorX - headX;
  const dy = sample.cursorY - headY;
  const distance = Math.hypot(dx, dy);
  const nextEngaged = engaged
    ? distance <= PET_MODE_GAZE_RELEASE_RADIUS_PX
    : distance <= PET_MODE_GAZE_ENGAGE_RADIUS_PX;
  if (!nextEngaged || distance === 0) {
    return { offset: { x: 0, y: 0 }, engaged: false, distance };
  }

  const amount = Math.max(0.28, easeInOut(Math.min(1, distance / 120)));
  const facingSign = sample.facing === "left" ? -1 : 1;
  return {
    offset: {
      x: (dx / distance) * PET_MODE_GAZE_MAX_OFFSET_PX * amount * facingSign,
      y: (dy / distance) * PET_MODE_GAZE_MAX_OFFSET_PX * amount * 0.78,
    },
    engaged: true,
    distance,
  };
}

export function dampPetModeGazeOffset(
  current: PetModeGazeOffset,
  target: PetModeGazeOffset,
  dtMs: number,
): PetModeGazeOffset {
  const follow = 1 - Math.exp(-Math.min(32, Math.max(0, dtMs)) / PET_MODE_GAZE_DAMP_MS);
  const x = current.x + (target.x - current.x) * follow;
  const y = current.y + (target.y - current.y) * follow;
  return {
    x: target.x === 0 && Math.abs(x) < 0.22 ? 0 : x,
    y: target.y === 0 && Math.abs(y) < 0.22 ? 0 : y,
  };
}
