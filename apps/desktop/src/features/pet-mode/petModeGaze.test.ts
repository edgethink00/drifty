import { describe, expect, it } from "vitest";
import {
  PET_MODE_GAZE_ENGAGE_RADIUS_PX,
  PET_MODE_GAZE_MAX_OFFSET_PX,
  PET_MODE_GAZE_RELEASE_RADIUS_PX,
  dampPetModeGazeOffset,
  petModeGazePoseForPhase,
  resolvePetModeGazeOffset,
} from "./petModeGaze";

const rest = {
  cursorX: 1000,
  cursorY: 40,
  windowX: 200,
  windowY: 20,
  windowWidth: 144,
  windowHeight: 99,
  facing: "right" as const,
  pose: "idle" as const,
  reducedMotion: false,
};

const idleHeadX = rest.windowX + 11.4 + 121.2 * (581.294 / 797);
const idleHeadY = rest.windowY + 4.2 + (92.4 - 121.2 * 581 / 797) / 2 + (121.2 * 581 / 797) * (254.445 / 581);

describe("petModeGaze", () => {
  it("keeps the eyes still until the pointer enters the nearby radius", () => {
    const far = resolvePetModeGazeOffset({
      ...rest,
      cursorX: rest.windowX + rest.windowWidth + PET_MODE_GAZE_ENGAGE_RADIUS_PX + 40,
      cursorY: rest.windowY + rest.windowHeight / 2,
    }, false);
    expect(far.engaged).toBe(false);
    expect(far.offset).toEqual({ x: 0, y: 0 });
    expect(far.distance).toBeGreaterThan(PET_MODE_GAZE_ENGAGE_RADIUS_PX);

    const justInside = resolvePetModeGazeOffset({
      ...rest,
      cursorX: idleHeadX + PET_MODE_GAZE_ENGAGE_RADIUS_PX - 1,
      cursorY: idleHeadY,
    }, false);
    const justOutside = resolvePetModeGazeOffset({
      ...rest,
      cursorX: idleHeadX + PET_MODE_GAZE_ENGAGE_RADIUS_PX + 1,
      cursorY: idleHeadY,
    }, false);
    expect(justInside.engaged).toBe(true);
    expect(justOutside.engaged).toBe(false);
    expect(PET_MODE_GAZE_ENGAGE_RADIUS_PX).toBe(80);
    expect(PET_MODE_GAZE_RELEASE_RADIUS_PX).toBe(110);
  });

  it("looks toward a nearby pointer and releases once it leaves the hysteresis band", () => {
    const near = resolvePetModeGazeOffset({
      ...rest,
      cursorX: idleHeadX + 40,
      cursorY: idleHeadY,
    }, false);
    expect(near.engaged).toBe(true);
    expect(near.offset.x).toBeGreaterThan(0.3);
    expect(Math.abs(near.offset.y)).toBeLessThan(0.05);
    expect(Math.hypot(near.offset.x, near.offset.y)).toBeLessThanOrEqual(PET_MODE_GAZE_MAX_OFFSET_PX + 1e-6);

    const stillNear = resolvePetModeGazeOffset({
      ...rest,
      cursorX: idleHeadX + 95,
      cursorY: idleHeadY,
    }, true);
    expect(stillNear.engaged).toBe(true);

    const left = resolvePetModeGazeOffset({
      ...rest,
      cursorX: idleHeadX + 140,
      cursorY: idleHeadY,
    }, true);
    expect(left.engaged).toBe(false);
    expect(left.offset).toEqual({ x: 0, y: 0 });
  });

  it("mirrors horizontal gaze when the cat faces left", () => {
    const right = resolvePetModeGazeOffset({
      ...rest,
      cursorX: idleHeadX + 50,
      cursorY: idleHeadY,
    }, false);
    const left = resolvePetModeGazeOffset({
      ...rest,
      facing: "left",
      cursorX: rest.windowX + 11.4 + 121.2 * (1 - 581.294 / 797) + 50,
      cursorY: idleHeadY,
    }, false);
    expect(right.engaged).toBe(true);
    expect(left.engaged).toBe(true);
    expect(left.offset.x).toBeCloseTo(-right.offset.x, 6);
  });

  it("does not follow during reduced motion or non-resting poses", () => {
    expect(petModeGazePoseForPhase("idle")).toBe("idle");
    expect(petModeGazePoseForPhase("sit")).toBe("sit");
    expect(petModeGazePoseForPhase("blink")).toBeNull();
    expect(petModeGazePoseForPhase("walk")).toBeNull();
    expect(petModeGazePoseForPhase("sleep")).toBeNull();
    const reduced = resolvePetModeGazeOffset({
      ...rest,
      reducedMotion: true,
      cursorX: rest.windowX + rest.windowWidth * (581.294 / 797) + 10,
      cursorY: rest.windowY + rest.windowHeight * (254.445 / 581),
    }, true);
    expect(reduced).toMatchObject({ offset: { x: 0, y: 0 }, engaged: false });
  });
  it("eases the offset toward the target instead of snapping", () => {
    const damped = dampPetModeGazeOffset({ x: 0, y: 0 }, { x: 1.5, y: 0 }, 16);
    expect(damped.x).toBeGreaterThan(0);
    expect(damped.x).toBeLessThan(1.5);
    expect(damped.y).toBe(0);
  });

  it("needs a logical sample; a 2x physical sample would miss the nearby radius", () => {
    const logical = resolvePetModeGazeOffset({
      ...rest,
      cursorX: idleHeadX + 50,
      cursorY: idleHeadY,
    }, false);
    const physical = {
      ...rest,
      windowX: rest.windowX * 2,
      windowY: rest.windowY * 2,
      windowWidth: rest.windowWidth * 2,
      windowHeight: rest.windowHeight * 2,
      cursorX: (idleHeadX + 50) * 2,
      cursorY: idleHeadY * 2,
    };
    const unconverted = resolvePetModeGazeOffset(physical, false);
    const converted = resolvePetModeGazeOffset({
      ...physical,
      cursorX: physical.cursorX / 2,
      cursorY: physical.cursorY / 2,
      windowX: physical.windowX / 2,
      windowY: physical.windowY / 2,
      windowWidth: physical.windowWidth / 2,
      windowHeight: physical.windowHeight / 2,
    }, false);
    expect(logical.engaged).toBe(true);
    expect(unconverted.engaged).toBe(false);
    expect(converted.engaged).toBe(true);
    expect(converted.offset.x).toBeCloseTo(logical.offset.x, 6);
  });
});
