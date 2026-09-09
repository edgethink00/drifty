import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_CORRECTION_POPOVER_VIEWPORT_PADDING,
  CLASSIFICATION_CORRECTION_POPOVER_WIDTH,
  getClassificationCorrectionPopoverFallbackPlacement,
  getClassificationCorrectionPopoverPlacement,
} from "./ClassificationCorrectionPopover";

const viewport = { width: 1440, height: 900 };

describe("correction popover placement", () => {
  it("hangs the card off its trigger when there is one", () => {
    const placement = getClassificationCorrectionPopoverPlacement(
      { left: 1100, right: 1140, top: 300, bottom: 320, width: 40, height: 20 },
      CLASSIFICATION_CORRECTION_POPOVER_WIDTH, 420, viewport,
    );
    expect(placement.side).toBe("below");
    expect(placement.left).toBe(1140 - CLASSIFICATION_CORRECTION_POPOVER_WIDTH);
  });

  it("still places the card when the trigger is gone, so an open editor is never invisible", () => {
    const placement = getClassificationCorrectionPopoverFallbackPlacement(CLASSIFICATION_CORRECTION_POPOVER_WIDTH, 420, viewport);
    expect(placement.left).toBe((viewport.width - CLASSIFICATION_CORRECTION_POPOVER_WIDTH) / 2);
    expect(placement.top).toBe((viewport.height - 420) / 2);
  });

  it("pins a card taller than the viewport to the top padding instead of drifting off screen", () => {
    const small = { width: 420, height: 500 };
    const placement = getClassificationCorrectionPopoverFallbackPlacement(CLASSIFICATION_CORRECTION_POPOVER_WIDTH, 2000, small);
    expect(placement.top).toBe(CLASSIFICATION_CORRECTION_POPOVER_VIEWPORT_PADDING);
    expect(placement.left).toBe((small.width - CLASSIFICATION_CORRECTION_POPOVER_WIDTH) / 2);
    expect(placement.left).toBeGreaterThanOrEqual(CLASSIFICATION_CORRECTION_POPOVER_VIEWPORT_PADDING);
  });

  it("keeps a card wider than the viewport at the left padding", () => {
    const placement = getClassificationCorrectionPopoverFallbackPlacement(CLASSIFICATION_CORRECTION_POPOVER_WIDTH, 200, { width: 200, height: 500 });
    expect(placement.left).toBe(CLASSIFICATION_CORRECTION_POPOVER_VIEWPORT_PADDING);
  });
});
