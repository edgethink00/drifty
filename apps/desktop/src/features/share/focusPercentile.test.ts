import { describe, expect, it } from "vitest";
import { estimateFocusTopPercent } from "./focusPercentile";

describe("estimateFocusTopPercent", () => {
  it("keeps the approved daily focus-card anchor near Top 0.4%", () => {
    expect(estimateFocusTopPercent(5 * 60 * 60 + 15 * 60, "daily")).toBeCloseTo(0.41, 2);
  });

  it("keeps the approved weekly focus-card anchor near Top 1.2%", () => {
    expect(estimateFocusTopPercent(20 * 60 * 60 + 20 * 60, "weekly")).toBe(1.2);
  });

  it("clamps the display model to a meaningful range", () => {
    expect(estimateFocusTopPercent(0, "daily")).toBeLessThan(99);
    expect(estimateFocusTopPercent(1_000 * 60 * 60, "weekly")).toBe(0.001);
  });
});
