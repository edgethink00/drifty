import { describe, expect, it } from "vitest";
import type { FlowBlock, ProductivityLevel } from "@drifty/domain";
import { levelFor, productivityKeyFor, withLevelRingEntries, withLevelSlices } from "./productivityLevelView";

const rest: ProductivityLevel = { id: "level-rest0001", name: "휴식", color: "#5b86b5", categories: ["entertainment"] };

function block(category: FlowBlock["category"], productivity: FlowBlock["productivity"]): FlowBlock {
  return { id: category + productivity, day: "2026-10-16", hour: 9, quarter: 0, minuteOfDay: 540, appName: "Arc", category, productivity, colorKey: category, durationSeconds: 60 };
}

describe("added productivity levels on charts", () => {
  it("files only neutral time in a fixed category under the level", () => {
    expect(levelFor("entertainment", "neutral", [rest])?.id).toBe("level-rest0001");
    // A manual drift correction in that category stays drift.
    expect(productivityKeyFor("entertainment", "drift", [rest])).toBe("drift");
    expect(productivityKeyFor("communication", "neutral", [rest])).toBe("neutral");
  });

  it("splits the level out of neutral right after it, keeping the other entries and the total", () => {
    const entry = (key: "focus" | "drift" | "neutral", totalSeconds: number, ratio: number) => ({
      key, label: key, color: "#000000", totalSeconds, ratio, matchesBlock: (candidate: FlowBlock) => candidate.productivity === key,
    });
    const entries = withLevelRingEntries([entry("focus", 3000, 0.6), entry("drift", 500, 0.1), entry("neutral", 1500, 0.3)], [rest], (category) => (category === "entertainment" ? 600 : 0));

    expect(entries.map((item) => [item.key, item.totalSeconds])).toEqual([["focus", 3000], ["drift", 500], ["neutral", 900], ["level-rest0001", 600]]);
    expect(entries.reduce((sum, item) => sum + item.ratio, 0)).toBeCloseTo(1);
    const neutral = entries.find((item) => item.key === "neutral")!;
    const level = entries.find((item) => item.key === "level-rest0001")!;
    expect(neutral.matchesBlock(block("entertainment", "neutral"))).toBe(false);
    expect(level.matchesBlock(block("entertainment", "neutral"))).toBe(true);
    expect(level.matchesBlock(block("entertainment", "drift"))).toBe(false);
  });

  it("leaves the slices alone without a level or level time", () => {
    const slices = [{ key: "focus", seconds: 100, color: "#000000", label: "focus" }, { key: "neutral", seconds: 50, color: "#000000", label: "neutral" }];
    expect(withLevelSlices(slices, [], () => 0)).toEqual(slices);
    expect(withLevelSlices(slices, [rest], () => 0)).toEqual(slices);
    expect(withLevelSlices(slices, [rest], () => 80).map((slice) => [slice.key, slice.seconds])).toEqual([["focus", 100], ["level-rest0001", 50]]);
  });
});
