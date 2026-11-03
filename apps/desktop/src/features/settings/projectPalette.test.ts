import { describe, expect, it } from "vitest";
import { firstUnusedProjectColor, isPaletteColor, PROJECT_COLOR_PALETTE } from "./projectPalette";

describe("firstUnusedProjectColor", () => {
  it("returns the first palette color when none are used", () => {
    expect(firstUnusedProjectColor([])).toBe(PROJECT_COLOR_PALETTE[0]);
  });

  it("skips colors already used, case-insensitively", () => {
    expect(firstUnusedProjectColor([PROJECT_COLOR_PALETTE[0].toUpperCase()])).toBe(PROJECT_COLOR_PALETTE[1]);
    expect(firstUnusedProjectColor([PROJECT_COLOR_PALETTE[0], PROJECT_COLOR_PALETTE[1]])).toBe(PROJECT_COLOR_PALETTE[2]);
  });

  it("balances successive projects after every preset is taken", () => {
    const used = [...PROJECT_COLOR_PALETTE];
    for (const expected of PROJECT_COLOR_PALETTE) {
      const next = firstUnusedProjectColor(used);
      expect(next).toBe(expected);
      used.push(next);
    }
  });

  it("counts legacy colors in their slots and ignores custom colors when balancing", () => {
    expect(firstUnusedProjectColor(["#6366F1"])).toBe(PROJECT_COLOR_PALETTE[1]);
    expect(firstUnusedProjectColor([...PROJECT_COLOR_PALETTE, "#6366F1", "#123456"]))
      .toBe(PROJECT_COLOR_PALETTE[1]);
  });
});

describe("isPaletteColor", () => {
  it("recognizes palette entries and rejects others", () => {
    expect(isPaletteColor(PROJECT_COLOR_PALETTE[3])).toBe(true);
    expect(isPaletteColor("#000000")).toBe(false);
  });
});
