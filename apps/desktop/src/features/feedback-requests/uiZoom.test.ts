import { describe, expect, it } from "vitest";
import { ZOOM_LEVELS, appliedZoom, levelFits, normalizeZoom, steppedZoom, zoomLimitForArea } from "./uiZoom";

describe("window size steps", () => {
  it("offers a step only while the screen leaves at least 960 x 600 of page", () => {
    // A 1440 x 900 screen holds every step; a 1280 x 700 one stops at 110%.
    const roomy = zoomLimitForArea(1440, 900);
    expect(ZOOM_LEVELS.filter((level) => levelFits(level, roomy))).toEqual([1, 1.1, 1.2, 1.3]);
    const short = zoomLimitForArea(1280, 700);
    expect(ZOOM_LEVELS.filter((level) => levelFits(level, short))).toEqual([1, 1.1]);
    // The default always fits, even on a screen smaller than the layout.
    expect(levelFits(1, zoomLimitForArea(800, 500))).toBe(true);
  });

  it("uses the largest fitting step when the saved one no longer fits", () => {
    const short = zoomLimitForArea(1280, 700);
    expect(appliedZoom(1.3, short)).toBe(1.1);
    expect(appliedZoom(1.3, null)).toBe(1.3);
    expect(appliedZoom(1.1, short)).toBe(1.1);
  });

  it("reads older saved sizes as the nearest step and steps only through fitting ones", () => {
    expect(normalizeZoom("1.4")).toBe(1.3);
    expect(normalizeZoom("1.25")).toBe(1.2);
    expect(normalizeZoom("nonsense")).toBe(1);
    const short = zoomLimitForArea(1280, 700);
    expect(steppedZoom(1.1, 1, short)).toBe(1.1);
    expect(steppedZoom(1.1, -1, short)).toBe(1);
    expect(steppedZoom(1.2, 1, null)).toBe(1.3);
  });
});

