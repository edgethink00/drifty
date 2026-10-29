import { describe, expect, it } from "vitest";
import { ZOOM_LEVELS, appliedZoom, levelFits, normalizeZoom, steppedZoom, zoomLimitForArea, zoomWindowSize, type WindowGrowth, type WindowSize } from "./uiZoom";

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

describe("the window around a zoom step", () => {
  const minimumAt = (zoom: number): WindowSize => ({ width: Math.round(960 * zoom), height: Math.round(680 * zoom) });

  /** Steps through zoom levels the way the runtime does, carrying the remembered growth. */
  function walk(start: WindowSize, zooms: readonly number[], resizeAfter?: { readonly index: number; readonly to: WindowSize }) {
    let size = start;
    let growth: WindowGrowth | null = null;
    const sizes: WindowSize[] = [];
    zooms.forEach((zoom, index) => {
      const next = zoomWindowSize(size, minimumAt(zoom), growth);
      growth = next.growth;
      size = next.size ?? size;
      if (resizeAfter?.index === index) size = resizeAfter.to;
      sizes.push(size);
    });
    return sizes;
  }

  it("grows the window only as far as a step needs and puts it back on the way down", () => {
    // The window the app opens with (1209 x 800) is narrower and shorter than 130% needs.
    expect(walk({ width: 1209, height: 800 }, [1.3, 1])).toEqual([
      { width: 1248, height: 884 },
      { width: 1209, height: 800 },
    ]);
  });

  it("returns to the starting size after several steps up and down", () => {
    const sizes = walk({ width: 1000, height: 700 }, [1.1, 1.2, 1.3, 1.2, 1]);
    expect(sizes[2]).toEqual({ width: 1248, height: 884 });
    expect(sizes[3]).toEqual({ width: 1152, height: 816 });
    expect(sizes[4]).toEqual({ width: 1000, height: 700 });
  });

  it("leaves a window that is already large enough alone", () => {
    expect(zoomWindowSize({ width: 1500, height: 950 }, minimumAt(1.3), null)).toEqual({ size: null, growth: null });
  });

  it("keeps the size the person chose after a step grew the window", () => {
    const sizes = walk({ width: 1000, height: 700 }, [1.3, 1], { index: 0, to: { width: 1400, height: 900 } });
    expect(sizes[1]).toEqual({ width: 1400, height: 900 });
  });

  it("tolerates the rounding of a size read back from physical pixels", () => {
    const grown = zoomWindowSize({ width: 1000, height: 700 }, minimumAt(1.3), null);
    const readBack = { width: 1247.5, height: 884.5 };
    expect(zoomWindowSize(readBack, minimumAt(1), grown.growth).size).toEqual({ width: 1000, height: 700 });
  });
});

