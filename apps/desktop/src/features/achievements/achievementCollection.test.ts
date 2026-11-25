import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_DEFINITIONS, type AchievementId } from "./achievementCatalog";
import { almostThere } from "./achievementCollection";
import type { AchievementItem } from "./useAchievements";

function item(id: AchievementId, patch: Partial<AchievementItem> = {}): AchievementItem {
  const definition = ACHIEVEMENT_DEFINITIONS.find((entry) => entry.id === id)!;
  return { definition, earned: null, progress: null, rarity: null, ...patch };
}

const earned = (count: number) => ({ firstDay: "2026-11-01", lastDay: "2026-11-20", count });

describe("almostThere", () => {
  it("puts the goals furthest along first and keeps hidden ones out", () => {
    const entries = almostThere([
      item("flow180", { progress: { current: 2, target: 3, unit: "seconds" } }),
      item("streak30", { progress: { current: 27, target: 30, unit: "days" } }),
      item("flow90", { earned: earned(8) }),
      item("noDriftDay", { progress: { current: 1, target: 2, unit: "seconds" } }),
      item("focusDay8h", { progress: { current: 0, target: 8, unit: "seconds" } }),
    ]);
    expect(entries.map((entry) => entry.item.definition.id)).toEqual(["streak30", "flow180"]);
  });
});
