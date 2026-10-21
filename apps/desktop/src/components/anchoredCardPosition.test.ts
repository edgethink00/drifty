// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANCHORED_CARD_GAP,
  ANCHORED_CARD_HOVER_ABANDON_TRAVEL_PX,
  ANCHORED_CARD_HOVER_BRIDGE_DELAY_MS,
  ANCHORED_CARD_VIEWPORT_PADDING,
  distanceToCardRect,
  getViewportSafeAnchoredPosition,
  isAnchorOutsideViewport,
  trackAnchoredHoverIntent,
} from "./anchoredCardPosition";

describe("anchored card hover timing", () => {
  it("caps pointer-bridge stalls at the shared 220ms motion token", () => {
    expect(ANCHORED_CARD_HOVER_BRIDGE_DELAY_MS).toBe(220);
  });
});

describe("getViewportSafeAnchoredPosition", () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
  });

  it("places the card beside the block instead of beside a pointer", () => {
    expect(getViewportSafeAnchoredPosition({ left: 120, top: 80, right: 240, bottom: 120, width: 120, height: 40 }, 332, 160)).toEqual({
      left: 240 + ANCHORED_CARD_GAP,
      top: 80,
      side: "right",
    });
  });

  it("flips to the block's left when the preferred side would overflow", () => {
    expect(getViewportSafeAnchoredPosition({ left: 650, top: 540, right: 750, bottom: 580, width: 100, height: 40 }, 332, 160)).toEqual({
      left: 650 - 332 - ANCHORED_CARD_GAP,
      top: 600 - 160 - ANCHORED_CARD_VIEWPORT_PADDING,
      side: "left",
    });
  });

  it("flips away from a neighboring card lane even when the viewport has room", () => {
    const p = getViewportSafeAnchoredPosition({ left: 400, top: 80, right: 420, bottom: 100, width: 20, height: 20 }, 332, 160, { left: 500, right: 800 });
    expect(p.side).toBe("left");
    expect(p.left + 332).toBeLessThanOrEqual(500 - ANCHORED_CARD_GAP);
  });

  it("keeps the neighboring lane clear when neither side fits beside the cell", () => {
    const p = getViewportSafeAnchoredPosition({ left: 250, top: 540, right: 270, bottom: 560, width: 20, height: 20 }, 332, 160, { left: 500, right: 800 });
    expect(p.left).toBeGreaterThanOrEqual(ANCHORED_CARD_VIEWPORT_PADDING);
    expect(p.left + 332).toBeLessThanOrEqual(500 - ANCHORED_CARD_GAP);
    expect(p.top + 160).toBeLessThanOrEqual(600 - ANCHORED_CARD_VIEWPORT_PADDING);
  });

  it("clamps a card when neither side has enough room", () => {
    expect(getViewportSafeAnchoredPosition({ left: 180, top: 8, right: 220, bottom: 48, width: 40, height: 40 }, 760, 700)).toEqual({
      left: 800 - 760 - ANCHORED_CARD_VIEWPORT_PADDING,
      top: ANCHORED_CARD_VIEWPORT_PADDING,
      side: "right",
    });
  });

  it("keeps a card to the right of a left-hand task lane", () => {
    const p = getViewportSafeAnchoredPosition({ left: 400, top: 80, right: 420, bottom: 100, width: 20, height: 20 }, 332, 160, { left: 16, right: 250 });
    expect(p.side).toBe("right");
    expect(p.left).toBeGreaterThanOrEqual(250 + ANCHORED_CARD_GAP);
    expect(p.left + 332).toBeLessThanOrEqual(800 - ANCHORED_CARD_VIEWPORT_PADDING);
  });

  it("uses the available chart space when neither side fits next to the cell beside a left-hand lane", () => {
    const p = getViewportSafeAnchoredPosition({ left: 650, top: 80, right: 670, bottom: 100, width: 20, height: 20 }, 332, 160, { left: 16, right: 350 });
    expect(p.left).toBeGreaterThanOrEqual(350 + ANCHORED_CARD_GAP);
    expect(p.left + 332).toBeLessThanOrEqual(800 - ANCHORED_CARD_VIEWPORT_PADDING);
  });
});

describe("isAnchorOutsideViewport", () => {
  it("distinguishes an offscreen block from an unresolved zero-size block", () => {
    expect(isAnchorOutsideViewport({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 })).toBe(false);
    expect(isAnchorOutsideViewport({ left: 20, top: -80, right: 100, bottom: -20, width: 80, height: 60 })).toBe(true);
  });
});

describe("trackAnchoredHoverIntent", () => {
  const card = { left: 220, top: 100, right: 552, bottom: 420, width: 332, height: 320 };

  it("measures the gap to the card edge and reads zero inside it", () => {
    expect(distanceToCardRect(180, 140, card)).toBe(40);
    expect(distanceToCardRect(300, 60, card)).toBe(40);
    expect(distanceToCardRect(190, 60, card)).toBe(50);
    expect(distanceToCardRect(300, 200, card)).toBe(0);
  });

  it("keeps waiting while each sample closes in on the card", () => {
    const first = trackAnchoredHoverIntent(null, 180, 140, card);
    expect(first.verdict).toBe("approaching");
    const closer = trackAnchoredHoverIntent(first.intent, 200, 150, card);
    expect(closer.verdict).toBe("approaching");
    // Diagonal travel that lands farther from the card, but within the allowance, is jitter.
    const jitter = trackAnchoredHoverIntent(closer.intent, 196, 156, card);
    expect(jitter.verdict).toBe("drifting");
    expect(jitter.intent).toBe(closer.intent);
    const inside = trackAnchoredHoverIntent(jitter.intent, 240, 160, card);
    expect(inside.verdict).toBe("approaching");
    expect(inside.intent.closestDistance).toBe(0);
  });

  it("abandons the card once the pointer travels past the allowance without closing in", () => {
    const start = trackAnchoredHoverIntent(null, 180, 140, card);
    const nearby = trackAnchoredHoverIntent(start.intent, 180 - ANCHORED_CARD_HOVER_ABANDON_TRAVEL_PX, 140, card);
    expect(nearby.verdict).toBe("drifting");
    const away = trackAnchoredHoverIntent(nearby.intent, 180 - ANCHORED_CARD_HOVER_ABANDON_TRAVEL_PX - 1, 140, card);
    expect(away.verdict).toBe("abandoned");
    // Travel is measured from the closest point so far, not from the last sample.
    const sideways = trackAnchoredHoverIntent(start.intent, 180, 140 + ANCHORED_CARD_HOVER_ABANDON_TRAVEL_PX + 2, card);
    expect(sideways.verdict).toBe("abandoned");
  });
});
