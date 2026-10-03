/**
 * Secondary motion for the travel phases.
 *
 * The gait frames are a faithful trace of the reference video, and that trace
 * captured a treadmill. Measured across all 30 frames of walk-frames-v2.json:
 * the muzzle tip does not move a single viewBox unit horizontally, the skull
 * top travels 1.6 units, and the rear-leg span travels 17.9. Only the legs
 * cycle. When native slides that vector gait across the desktop, the result
 * reads as a drawing being dragged rather than an animal moving.
 *
 * This module adds the missing whole-body motion. Nothing here redraws or
 * interpolates the approved contours, which MOTION_REDESIGN.md AP-01 forbids:
 * every value is a rigid transform of the already-approved silhouette,
 * expressed as CSS custom properties so the transforms run as real CSS
 * animations.
 *
 * Running them as CSS animations is load-bearing rather than stylistic. The
 * hit-region generator drives document.getAnimations() across 121 samples and
 * unions the resulting alpha masks, so a CSS-driven pose is captured by that
 * bake while a JS-driven inline transform would not be, and the grabbable area
 * would silently drift off the drawn cat.
 */

import type { CSSProperties } from "react";

export type PetModeChaseMotionKind = "walk" | "run" | "stalk" | "return" | "bite";

export type PetModeChaseProfile = {
  /** Whole-body lean, degrees. Positive drops the nose toward travel. */
  readonly leanDeg: number;
  /** Whole-body vertical bounce, viewBox units. */
  readonly bounceUnits: number;
  /** Head rotation about the neck pivot, degrees, centre-to-peak. */
  readonly headSwingDeg: number;
  /** Head translation along the travel axis, viewBox units. */
  readonly headLeadUnits: number;
};

/**
 * Neck pivot, in walk-frames viewBox units.
 *
 * Buried inside the shoulder mass rather than placed on the visible neck line.
 * AP-06 recorded that a pivot on the outline swings the rotated part clear of
 * the body and reads as a detached limb; keeping it inside means the shoulder
 * overlap absorbs the rotation and no gap can open.
 */
export const PET_MODE_NECK_PIVOT_X = 104;
export const PET_MODE_NECK_PIVOT_Y = 52;

/**
 * Where the head layer is cut out of the silhouette.
 *
 * A scanline sweep found no waist to cut on: thickness falls monotonically from
 * 94 units at x=100 to 17 at the muzzle, with no local minimum anywhere along
 * the neck. So the head is not seamed at all. It is clipped with deliberate
 * overlap well behind the pivot and drawn over a complete, unclipped body, so
 * body pixels always cover the join regardless of which way the head turns.
 */
export const PET_MODE_HEAD_CLIP_X = 96;

/** Body lean pivot: low and central, so the hips carry the lean. */
export const PET_MODE_LEAN_PIVOT_X = 75;
export const PET_MODE_LEAN_PIVOT_Y = 96;

/**
 * Per-phase amplitude.
 *
 * walk is the normal roam state that MOTION_REDESIGN.md gate 9 caps at 2 CSS px
 * of vertical excursion, so it stays deliberately small. The chase phases are
 * not roam: they are short, intentional, and already move the window ten times
 * faster, so they carry the amplitude that makes the motion read.
 */
const PROFILES: Record<PetModeChaseMotionKind, PetModeChaseProfile> = {
  walk: { leanDeg: 0.6, bounceUnits: 0.35, headSwingDeg: 0.9, headLeadUnits: 0.35 },
  // Used only by the vector override/fallback. The authored run carries
  // this motion inside its raster frames and PetModeCat suppresses this layer.
  run: { leanDeg: 3.2, bounceUnits: 1.5, headSwingDeg: 2.4, headLeadUnits: 1.15 },
  stalk: { leanDeg: 2.1, bounceUnits: 0.9, headSwingDeg: 1.5, headLeadUnits: 0.8 },
  return: { leanDeg: 1.6, bounceUnits: 1, headSwingDeg: 1.2, headLeadUnits: 0.6 },
  // Contact is a held pose, so the body settles into a lean instead of cycling.
  bite: { leanDeg: 1.1, bounceUnits: 0, headSwingDeg: 0, headLeadUnits: 0 },
};

export const PET_MODE_CHASE_MOTION_KINDS = Object.keys(PROFILES) as readonly PetModeChaseMotionKind[];

export function petModeChaseProfile(kind: PetModeChaseMotionKind): PetModeChaseProfile | null {
  return PROFILES[kind] ?? null;
}

export function isPetModeChaseMotionKind(value: string): value is PetModeChaseMotionKind {
  return Object.prototype.hasOwnProperty.call(PROFILES, value);
}

/**
 * Cycle length for the secondary motion.
 *
 * Bounce has to land on the gait's own contacts, so the body animation shares
 * the leg cycle's duration rather than free-running. Both are time-driven from
 * the same phase start, so matching the duration keeps them locked without
 * introducing a second clock.
 */
export function petModeChaseCycleMs(gaitFramesPerSecond: number, frameCount: number): number {
  if (!Number.isFinite(gaitFramesPerSecond) || gaitFramesPerSecond <= 0) return 0;
  if (!Number.isFinite(frameCount) || frameCount <= 0) return 0;
  return (frameCount / gaitFramesPerSecond) * 1000;
}

/**
 * CSS custom properties for one travel phase.
 *
 * direction is +1 when the cat travels the way it faces. It is applied here
 * rather than in CSS because the parent mirror already flips the whole layer:
 * the lean has to reverse with actual travel, not with facing.
 */
export function petModeChaseMotionStyle(
  kind: PetModeChaseMotionKind | null,
  options: {
    readonly cycleMs?: number;
    readonly direction?: number;
    readonly reducedMotion?: boolean;
  } = {},
): CSSProperties {
  const profile = kind ? PROFILES[kind] ?? null : null;
  if (!profile || options.reducedMotion) {
    return {
      "--pet-chase-lean": "0deg",
      "--pet-chase-bounce": "0px",
      "--pet-chase-head-swing": "0deg",
      "--pet-chase-head-lead": "0px",
      "--pet-chase-cycle": "0ms",
    } as CSSProperties;
  }
  const direction = clamp(options.direction ?? 1, -1, 1);
  const cycleMs = Number.isFinite(options.cycleMs) && (options.cycleMs ?? 0) > 0
    ? (options.cycleMs as number)
    : 0;
  return {
    "--pet-chase-lean": (profile.leanDeg * direction).toFixed(3) + "deg",
    "--pet-chase-bounce": profile.bounceUnits.toFixed(3) + "px",
    "--pet-chase-head-swing": profile.headSwingDeg.toFixed(3) + "deg",
    "--pet-chase-head-lead": (profile.headLeadUnits * direction).toFixed(3) + "px",
    "--pet-chase-cycle": cycleMs.toFixed(0) + "ms",
  } as CSSProperties;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

/**
 * Peak displacement of any silhouette pixel, in 144-wide panel points.
 *
 * This sizes the hit-region bake rather than limiting the motion. The baked
 * mask is the union across the swept cycle, so this reports how much wider than
 * the static silhouette that union can get.
 */
export function petModeChaseMotionPeakDisplacementPx(kind: PetModeChaseMotionKind): number {
  const profile = PROFILES[kind];
  if (!profile) return 0;
  // The 150 x 120 viewBox maps onto the 121.2 x 92.4 cat box inside the panel.
  const unitToPx = 121.2 / 150;
  // Farthest silhouette point from the lean pivot is the skull top / tail tip,
  // both roughly 86 units away.
  const leanPx = Math.abs(profile.leanDeg * Math.PI / 180) * 86 * unitToPx;
  // Farthest head pixel from the neck pivot is the muzzle, roughly 42 units.
  const headPx = Math.abs(profile.headSwingDeg * Math.PI / 180) * 42 * unitToPx;
  const translatePx = (profile.bounceUnits + Math.abs(profile.headLeadUnits)) * unitToPx;
  return leanPx + headPx + translatePx;
}

/**
 * Ground-line budget, measured off rendered captures rather than derived.
 *
 * The CSS transforms compose with the gait registration shift, so the only
 * trustworthy figure is the one taken from pixels. These come from
 * .qa-captures/20260829-pet-chase-motion/; regenerate them with
 * scripts/pet-mode-hit-qa/capture-chase-motion.mjs after changing amplitudes.
 */
/** The dashed feet guide, and the line the approved gait rests on. */
export const PET_MODE_FOOT_GUIDE_Y = 93;
/** Lowest rendered foot pixel across every travel phase and cycle position. */
export const PET_MODE_MEASURED_FOOT_FLOOR_Y = 96.67;
/** Panel height. A foot below this is clipped by the window edge. */
export const PET_MODE_PANEL_HEIGHT = 99;
