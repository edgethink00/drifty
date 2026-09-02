// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANCHORED_CARD_GAP,
  ANCHORED_CARD_VIEWPORT_PADDING,
  getViewportSafeAnchoredPosition,
  isAnchorOutsideViewport,
} from "./anchoredCardPosition";

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

  it("clamps a card when neither side has enough room", () => {
    expect(getViewportSafeAnchoredPosition({ left: 180, top: 8, right: 220, bottom: 48, width: 40, height: 40 }, 760, 700)).toEqual({
      left: 800 - 760 - ANCHORED_CARD_VIEWPORT_PADDING,
      top: ANCHORED_CARD_VIEWPORT_PADDING,
      side: "right",
    });
  });
});

describe("isAnchorOutsideViewport", () => {
  it("distinguishes an offscreen block from an unresolved zero-size block", () => {
    expect(isAnchorOutsideViewport({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 })).toBe(false);
    expect(isAnchorOutsideViewport({ left: 20, top: -80, right: 100, bottom: -20, width: 80, height: 60 })).toBe(true);
  });
});
