// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getViewportSafeHoverPosition, HOVER_CARD_OFFSET, HOVER_CARD_VIEWPORT_PADDING } from "./hoverCardPosition";

describe("getViewportSafeHoverPosition", () => {
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

  it("uses the pointer offset when the card fits", () => {
    expect(getViewportSafeHoverPosition(120, 80, 240, 120)).toEqual({
      left: 120 + HOVER_CARD_OFFSET,
      top: 80 + HOVER_CARD_OFFSET,
    });
  });

  it("flips beside the pointer when the preferred position would overflow", () => {
    expect(getViewportSafeHoverPosition(760, 560, 240, 120)).toEqual({
      left: 760 - 240 - HOVER_CARD_OFFSET,
      top: 560 - 120 - HOVER_CARD_OFFSET,
    });
  });

  it("pins oversized cards to the viewport padding", () => {
    expect(getViewportSafeHoverPosition(400, 300, 900, 700)).toEqual({
      left: HOVER_CARD_VIEWPORT_PADDING,
      top: HOVER_CARD_VIEWPORT_PADDING,
    });
  });
});
