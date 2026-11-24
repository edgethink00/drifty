import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_DEFINITIONS, type AchievementId } from "./achievementCatalog";
import { achievementHoldings, almostThere } from "./achievementCollection";
import type { AchievementItem } from "./useAchievements";

function item(id: AchievementId, patch: Partial<AchievementItem> = {}): AchievementItem {
  const definition = ACHIEVEMENT_DEFINITIONS.find((entry) => entry.id === id)!;
  return { definition, earned: null, progress: null, rarity: null, ...patch };
}

const earned = (count: number) => ({ firstDay: "2026-11-01", lastDay: "2026-11-20", count });

describe("achievementHoldings", () => {
  it("counts held achievements by rarity tier when every one has a rarity", () => {
    const holdings = achievementHoldings([
      item("firstFlow", { earned: earned(1), rarity: { percent: 71, basisCount: 1240 } }),
      item("flow180", { earned: earned(2), rarity: { percent: 6.2, basisCount: 1240 } }),
      item("noDriftDay", { earned: earned(1), rarity: { percent: 0.7, basisCount: 1240 } }),
      item("comeback", { rarity: { percent: 3.4, basisCount: 1240 } }),
    ]);
    expect(holdings).toEqual({ kind: "rarity", total: 3, tiers: [{ tier: 1, count: 1 }, { tier: 2, count: 0 }, { tier: 3, count: 1 }, { tier: 4, count: 0 }, { tier: 5, count: 1 }] });
  });

  it("counts by medal metal when rarity is unknown, and is empty before anything is earned", () => {
    expect(achievementHoldings([item("flow90", { earned: earned(12) }), item("streak7", { earned: earned(60) }), item("firstFlow", { earned: earned(1) })]))
      .toEqual({ kind: "medal", total: 3, medals: [{ medal: "silver", count: 1 }, { medal: "gold", count: 1 }, { medal: "ring", count: 1 }] });
    expect(achievementHoldings([item("flow90")])).toBeNull();
  });
});

describe("almostThere", () => {
  it("puts the goals furthest along first and keeps hidden ones out", () => {
    const entries = almostThere([
      item("flow180", { progress: { current: 2, target: 3, unit: "seconds" } }),
      item("streak30", { progress: { current: 27, target: 30, unit: "days" } }),
      item("flow90", { earned: earned(8) }),
      item("noDriftDay", { progress: { current: 1, target: 2, unit: "seconds" } }),
      item("focusDay8h", { progress: { current: 0, target: 8, unit: "seconds" } }),
    ]);
    expect(entries.map((entry) => [entry.item.definition.id, entry.kind])).toEqual([["streak30", "unlock"], ["flow90", "medal"], ["flow180", "unlock"]]);
    expect(almostThere([item("flow90", { earned: earned(8) })], { medals: false })).toEqual([]);
  });
});
