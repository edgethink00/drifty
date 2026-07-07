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

  it("cycles once every preset is taken instead of repeating the first", () => {
    expect(firstUnusedProjectColor([...PROJECT_COLOR_PALETTE])).toBe(PROJECT_COLOR_PALETTE[0]);
  });
});

describe("isPaletteColor", () => {
  it("recognizes palette entries and rejects others", () => {
    expect(isPaletteColor(PROJECT_COLOR_PALETTE[3])).toBe(true);
    expect(isPaletteColor("#000000")).toBe(false);
  });
});
