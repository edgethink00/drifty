import { describe, expect, it } from "vitest";
import { achievementDefinition } from "./achievementCatalog";
import { achievementTier, difficultyTier, formatRarityPercent, rarityTier } from "./achievementRarity";

describe("achievement rarity", () => {
  it("names tiers by how few people have the achievement", () => {
    expect([71, 40, 39.9, 15, 6.2, 5, 4.1, 1, 0.7].map(rarityTier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });

  it("falls back to the catalogue's difficulty until a share of users exists", () => {
    expect(difficultyTier(achievementDefinition("firstFlow"))).toBe(1);
    expect(difficultyTier(achievementDefinition("flow180"))).toBe(4);
    expect(achievementTier(achievementDefinition("firstFlow"), { percent: 0.4, basisCount: 900 })).toBe(5);
  });

  it("keeps one decimal below ten percent and none above", () => {
    expect(formatRarityPercent(6.25, "en")).toBe("6.3");
    expect(formatRarityPercent(34.4, "en")).toBe("34");
  });
});

