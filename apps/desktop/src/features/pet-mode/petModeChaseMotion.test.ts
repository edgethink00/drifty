import { describe, expect, it } from "vitest";
import { PET_MODE_GAIT_FRAME_COUNT, getPetModeGaitFramesPerSecond } from "./petModeData";
import {
  PET_MODE_CHASE_MOTION_KINDS,
  PET_MODE_FOOT_GUIDE_Y,
  PET_MODE_HEAD_CLIP_X,
  PET_MODE_LEAN_PIVOT_Y,
  PET_MODE_MEASURED_FOOT_FLOOR_Y,
  PET_MODE_NECK_PIVOT_X,
  PET_MODE_NECK_PIVOT_Y,
  PET_MODE_PANEL_HEIGHT,
  isPetModeChaseMotionKind,
  petModeChaseCycleMs,
  petModeChaseMotionPeakDisplacementPx,
  petModeChaseMotionStyle,
  petModeChaseProfile,
  type PetModeChaseMotionKind,
} from "./petModeChaseMotion";

function style(kind: PetModeChaseMotionKind | null, options = {}) {
  return petModeChaseMotionStyle(kind, options) as Record<string, string>;
}

describe("petModeChaseMotion", () => {
  it("gives every travel phase real body motion, which the traced gait has none of", () => {
    // The whole reason this module exists: across all 30 traced frames the
    // muzzle moves 0.00 units and the skull top 1.60, so the silhouette is a
    // treadmill. If these amplitudes ever collapse the cat slides again.
    for (const kind of ["run", "stalk", "return"] as const) {
      const profile = petModeChaseProfile(kind);
      expect(profile).not.toBeNull();
      expect(profile!.bounceUnits).toBeGreaterThan(0.5);
      expect(profile!.headSwingDeg).toBeGreaterThan(1);
      expect(profile!.leanDeg).toBeGreaterThan(1);
    }
  });

  it("keeps roam calmer than the chase phases", () => {
    // MOTION_REDESIGN gate 9 caps the normal roam state at 2 CSS px of
    // vertical excursion. Roam is the state that gate is about; the chase
    // phases are short and intentional.
    const walk = petModeChaseProfile("walk")!;
    const run = petModeChaseProfile("run")!;
    expect(walk.bounceUnits).toBeLessThan(run.bounceUnits);
    expect(walk.leanDeg).toBeLessThan(run.leanDeg);
    expect(petModeChaseMotionPeakDisplacementPx("walk")).toBeLessThan(2);
  });

  it("emits zero motion under reduced motion for every phase", () => {
    for (const kind of PET_MODE_CHASE_MOTION_KINDS) {
      const reduced = style(kind, { cycleMs: 900, direction: 1, reducedMotion: true });
      expect(reduced["--pet-chase-lean"]).toBe("0deg");
      expect(reduced["--pet-chase-bounce"]).toBe("0px");
      expect(reduced["--pet-chase-head-swing"]).toBe("0deg");
      expect(reduced["--pet-chase-head-lead"]).toBe("0px");
      expect(reduced["--pet-chase-cycle"]).toBe("0ms");
    }
  });

  it("emits zero motion for a non-travel phase", () => {
    const resting = style(null, { cycleMs: 900 });
    expect(resting["--pet-chase-lean"]).toBe("0deg");
    expect(resting["--pet-chase-cycle"]).toBe("0ms");
  });

  it("reverses lean and head lead with travel direction, not with facing", () => {
    // The parent mirror already flips the whole layer for facing. If these
    // reversed with facing too, a left-facing run would lean backwards.
    const forward = style("run", { cycleMs: 900, direction: 1 });
    const backward = style("run", { cycleMs: 900, direction: -1 });
    expect(parseFloat(forward["--pet-chase-lean"])).toBeCloseTo(-parseFloat(backward["--pet-chase-lean"]), 6);
    expect(parseFloat(forward["--pet-chase-head-lead"])).toBeCloseTo(-parseFloat(backward["--pet-chase-head-lead"]), 6);
    // Bounce is vertical, so it must not flip with direction.
    expect(forward["--pet-chase-bounce"]).toBe(backward["--pet-chase-bounce"]);
  });

  it("holds the body still during the contact pose", () => {
    const bite = petModeChaseProfile("bite")!;
    expect(bite.bounceUnits).toBe(0);
    expect(bite.headSwingDeg).toBe(0);
    expect(bite.headLeadUnits).toBe(0);
    expect(bite.leanDeg).toBeGreaterThan(0);
  });

  it("locks the bounce cycle to the gait cycle so contacts line up", () => {
    // A free-running body cycle drifts against the legs and the cat bounces
    // while airborne. Same duration, same start, no second clock.
    for (const motion of ["walk", "run", "stalk", "return"] as const) {
      const fps = getPetModeGaitFramesPerSecond(motion);
      const cycleMs = petModeChaseCycleMs(fps, PET_MODE_GAIT_FRAME_COUNT);
      expect(cycleMs).toBeCloseTo((PET_MODE_GAIT_FRAME_COUNT / fps) * 1000, 6);
      expect(cycleMs).toBeGreaterThan(0);
    }
  });

  it("refuses to emit a cycle from a nonsense frame rate", () => {
    // A zero or negative duration would make the CSS animation never advance,
    // which looks exactly like the frozen body this module is fixing.
    expect(petModeChaseCycleMs(0, PET_MODE_GAIT_FRAME_COUNT)).toBe(0);
    expect(petModeChaseCycleMs(-4, PET_MODE_GAIT_FRAME_COUNT)).toBe(0);
    expect(petModeChaseCycleMs(Number.NaN, PET_MODE_GAIT_FRAME_COUNT)).toBe(0);
    expect(petModeChaseCycleMs(24, 0)).toBe(0);
  });

  it("ignores a non-finite direction instead of emitting NaN into CSS", () => {
    // A NaN custom property silently disables the whole transform, which would
    // reintroduce the frozen body without any error.
    const broken = style("run", { cycleMs: 900, direction: Number.NaN });
    expect(broken["--pet-chase-lean"]).toBe("0.000deg");
    expect(broken["--pet-chase-head-lead"]).toBe("0.000px");
    for (const value of Object.values(broken)) expect(value).not.toContain("NaN");
  });

  it("clamps an out-of-range direction rather than amplifying the lean", () => {
    const clamped = style("run", { cycleMs: 900, direction: 12 });
    const unit = style("run", { cycleMs: 900, direction: 1 });
    expect(clamped["--pet-chase-lean"]).toBe(unit["--pet-chase-lean"]);
  });

  it("buries the neck pivot inside the shoulder mass", () => {
    // AP-06: a pivot on the visible outline swings the rotated part clear of
    // the body and reads as a fifth limb. The clip must start behind the pivot
    // so shoulder pixels always cover the join.
    expect(PET_MODE_HEAD_CLIP_X).toBeLessThan(PET_MODE_NECK_PIVOT_X);
    expect(PET_MODE_NECK_PIVOT_Y).toBeGreaterThan(40);
    expect(PET_MODE_NECK_PIVOT_Y).toBeLessThan(70);
    // The lean pivot sits at the feet so the body tips rather than slides.
    expect(PET_MODE_LEAN_PIVOT_Y).toBeGreaterThan(PET_MODE_NECK_PIVOT_Y);
  });

  it("recognises exactly the travel phases", () => {
    for (const kind of PET_MODE_CHASE_MOTION_KINDS) expect(isPetModeChaseMotionKind(kind)).toBe(true);
    for (const other of ["idle", "sit", "sleep", "drag", "toString"]) {
      expect(isPetModeChaseMotionKind(other)).toBe(false);
    }
    expect(petModeChaseProfile("nope" as PetModeChaseMotionKind)).toBeNull();
    expect(petModeChaseMotionPeakDisplacementPx("nope" as PetModeChaseMotionKind)).toBe(0);
  });

  it("keeps the bounced foot line inside the panel", () => {
    // Bounce pushes the paws below the resting ground line. The panel is only
    // 99 points tall and clips anything past its edge, so a larger amplitude
    // would cut the paws off against the window rather than read as heavier.
    // Measured from the rendered captures, not derived: the transforms compose
    // with the gait registration shift.
    expect(PET_MODE_MEASURED_FOOT_FLOOR_Y).toBeGreaterThan(PET_MODE_FOOT_GUIDE_Y);
    expect(PET_MODE_MEASURED_FOOT_FLOOR_Y).toBeLessThan(PET_MODE_PANEL_HEIGHT);
    // Keep a real margin rather than sitting on the edge: the measurement is
    // taken at one size scale and users can enlarge the pet.
    expect(PET_MODE_PANEL_HEIGHT - PET_MODE_MEASURED_FOOT_FLOOR_Y).toBeGreaterThan(2);
  });
});
