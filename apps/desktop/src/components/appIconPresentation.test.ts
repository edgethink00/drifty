import { describe, expect, it } from "vitest";
import { paddedIconCrop } from "./appIconPresentation";

function pixels(width: number, height: number, points: Array<[number, number, number]>) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha] of points) rgba[(y * width + x) * 4 + 3] = alpha;
  return rgba;
}

describe("app icon presentation", () => {
  it("centers a padded, off-center logo in a square without stretching it", () => {
    const crop = paddedIconCrop(100, 100, pixels(100, 100, [[20, 30, 255], [39, 69, 255]]));
    expect(crop).not.toBeNull();
    expect(crop!.width).toBe(crop!.height);
    expect(crop!.x + crop!.width / 2).toBe(30);
    expect(crop!.y + crop!.height / 2).toBe(50);
    expect(40 / crop!.height).toBeCloseTo(0.88);
  });
  it("retains faint shadows and caps enlargement of very small marks", () => {
    const crop = paddedIconCrop(100, 100, pixels(100, 100, [[49, 49, 255], [42, 45, 1]]))!;
    expect(crop.width).toBe(25);
    expect(crop.x).toBeLessThan(42);
    expect(crop.y).toBeLessThan(45);
    expect(crop.x + crop.width).toBeGreaterThan(49);
  });
  it("leaves tight, opaque, empty, and malformed images alone", () => {
    expect(paddedIconCrop(100, 100, pixels(100, 100, [[0, 0, 255], [99, 99, 255]]))).toBeNull();
    expect(paddedIconCrop(100, 100, pixels(100, 100, []))).toBeNull();
    expect(paddedIconCrop(0, 0, new Uint8ClampedArray())).toBeNull();
    expect(paddedIconCrop(100, 100, new Uint8ClampedArray(4))).toBeNull();
  });
});
