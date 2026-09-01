import {
  PET_MODE_GAIT_BASELINE_SHIFT_PX,
  PET_MODE_GAIT_CENTER_SHIFT_PX,
} from "./petModeData";

export type PetModeGazePose = "idle" | "sit" | "walk";

export type PetModeGazeSample = {
  readonly cursorX: number;
  readonly cursorY: number;
  readonly windowX: number;
  readonly windowY: number;
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly facing: "left" | "right";
  readonly pose: PetModeGazePose;
  /** Optional normalized eye midpoint for sit artwork with a distinct face. */
  readonly sitGazeAnchor?: { readonly x: number; readonly y: number };
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
// Midpoint of the two walk-face eyes, in walk-frames viewBox units. The travel
// phases draw that vector rather than the idle raster, so aiming at the idle
// head would put the pivot roughly a third of a body behind the actual eyes.
const WALK_HEAD = {
  x: ((120.4 + 140.3) / 2 + PET_MODE_GAIT_CENTER_SHIFT_PX) / 150,
  y: (46.2 + PET_MODE_GAIT_BASELINE_SHIFT_PX) / 120,
};
const PET_PANEL = { width: 144, height: 99 };
const PET_CAT = { left: 11.4, top: 4.2, width: 121.2, height: 92.4 };

function petModeGazeHead(sample: PetModeGazeSample): { readonly x: number; readonly y: number } {
  const scaleX = sample.windowWidth / PET_PANEL.width;
  const scaleY = sample.windowHeight / PET_PANEL.height;
  const catLeft = sample.windowX + PET_CAT.left * scaleX;
  const catTop = sample.windowY + PET_CAT.top * scaleY;
  const catWidth = PET_CAT.width * scaleX;
  const catHeight = PET_CAT.height * scaleY;
  const head = sample.pose === "sit"
    ? sample.sitGazeAnchor ?? SIT_HEAD
    : sample.pose === "walk"
      ? WALK_HEAD
      : IDLE_HEAD;
  // The sit and walk poses both draw a 150x120 vector into the cat box, so they
  // letterbox on the same axis; only the idle raster uses the 797x581 canvas.
  const vectorPose = sample.pose === "sit" || sample.pose === "walk";
  const localX = sample.facing === "left" ? 1 - head.x : head.x;
  if (vectorPose) {
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
  if (phase === "idle" || phase === "notice") {
    return "idle";
  }
  if (phase === "sit") {
    return "sit";
  }
  // Chasing with dead-ahead eyes was the oddest part of the hunt: the cat
  // sprints at the cursor while looking straight past it. These phases draw
  // the walk vector, whose eyes are a separate SVG group, so they can track
  // the target the whole way in.
  if (phase === "stalk" || phase === "run" || phase === "bite" || phase === "return") {
    return "walk";
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
