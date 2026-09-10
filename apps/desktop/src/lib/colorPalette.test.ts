import { describe, expect, it } from "vitest";
import { BALANCED_PRESETS, PROJECT_COLOR_SLOTS, normalizeProjectColor, presetForColor } from "./colorPalette";

describe("app palette", () => {
  it("keeps project slots inside the shared preset family", () => {
    const presets = new Set(BALANCED_PRESETS.map((preset) => preset.color));
    for (const slot of PROJECT_COLOR_SLOTS) expect(presets.has(slot.color)).toBe(true);
  });

  it("gives every project slot a distinct color and a distinct legacy value", () => {
    expect(new Set(PROJECT_COLOR_SLOTS.map((slot) => slot.color)).size).toBe(PROJECT_COLOR_SLOTS.length);
    expect(new Set(PROJECT_COLOR_SLOTS.map((slot) => slot.legacy)).size).toBe(PROJECT_COLOR_SLOTS.length);
    expect(new Set(BALANCED_PRESETS.map((preset) => preset.id)).size).toBe(BALANCED_PRESETS.length);
  });

  it("resolves legacy vivid project colors to their slot, case-insensitively", () => {
    expect(normalizeProjectColor("#6366f1")).toBe("#5366a3");
    expect(normalizeProjectColor(" #EC4899 ")).toBe("#9b5b91");
  });

  it("is idempotent and leaves custom colors alone", () => {
    expect(normalizeProjectColor(normalizeProjectColor("#f59e0b"))).toBe("#a1792f");
    expect(normalizeProjectColor("#123456")).toBe("#123456");
    expect(normalizeProjectColor("#ABCDEF")).toBe("#abcdef");
  });

  it("looks up presets by hex regardless of case", () => {
    expect(presetForColor("#5F7F31")?.id).toBe("moss");
    expect(presetForColor("#000000")).toBeUndefined();
  });
});
