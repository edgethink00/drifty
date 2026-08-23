import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_FOCUS_RATE_DESCRIPTION,
  CLASSIFICATION_FOCUS_RATE_LABEL,
  buildFocusRatePercent,
} from "./classificationFocusRate";

describe("buildFocusRatePercent", () => {
  it("names the metric as focus rate instead of classification quality", () => {
    expect(CLASSIFICATION_FOCUS_RATE_LABEL).toBe("Focus rate");
    expect(CLASSIFICATION_FOCUS_RATE_DESCRIPTION).toBe("Share of tracked time labeled Focus");
  });

  it("returns 0 when nothing is tracked", () => {
    expect(buildFocusRatePercent([])).toBe(0);
    expect(buildFocusRatePercent([{ productivity: "focus", totalSeconds: 0, segments: 0, ratio: 0 }])).toBe(0);
  });

  it("rounds the share of tracked time labeled Focus", () => {
    expect(buildFocusRatePercent([
      { productivity: "focus", totalSeconds: 30, segments: 1, ratio: 0.5 },
      { productivity: "drift", totalSeconds: 30, segments: 1, ratio: 0.5 },
    ])).toBe(50);
    expect(buildFocusRatePercent([
      { productivity: "focus", totalSeconds: 2, segments: 1, ratio: 2 / 3 },
      { productivity: "drift", totalSeconds: 1, segments: 1, ratio: 1 / 3 },
    ])).toBe(67);
  });
});
