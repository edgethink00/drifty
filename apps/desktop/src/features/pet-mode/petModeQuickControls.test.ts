import { describe, expect, it } from "vitest";
import {
  PET_QUICK_CONTROLS_GAP,
  PET_QUICK_CONTROLS_WIDTH,
  PET_QUICK_CONTROLS_HEIGHT,
  layoutPetQuickControls,
} from "./petModeQuickControls";

describe("layoutPetQuickControls", () => {
  const workArea = { x: 0, y: 0, width: 1440, height: 900 };

  it("places the bar below a top-resident cat", () => {
    const layout = layoutPetQuickControls({
      pet: { x: 1200, y: 14, width: 144, height: 99 },
      workArea,
    });
    expect(layout.placement).toBe("below");
    expect(layout.y).toBe(14 + 99 + PET_QUICK_CONTROLS_GAP);
    expect(layout.width).toBe(PET_QUICK_CONTROLS_WIDTH);
    expect(layout.height).toBe(PET_QUICK_CONTROLS_HEIGHT);
    expect(layout.x + layout.width).toBeLessThanOrEqual(workArea.width - 8);
  });

  it("flips above when the cat sits near the bottom edge", () => {
    const layout = layoutPetQuickControls({
      pet: { x: 200, y: 860, width: 144, height: 99 },
      workArea,
    });
    expect(layout.placement).toBe("above");
    expect(layout.y).toBe(860 - PET_QUICK_CONTROLS_HEIGHT - PET_QUICK_CONTROLS_GAP);
  });
});
