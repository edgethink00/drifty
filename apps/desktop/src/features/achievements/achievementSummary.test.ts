import { describe, expect, it } from "vitest";
import { translateFor } from "../localization/translate";
import { ACHIEVEMENT_DEFINITIONS, type AchievementId } from "./achievementCatalog";
import { achievementSummary } from "./achievementSummary";
import type { AchievementItem } from "./useAchievements";

function item(id: AchievementId, patch: Partial<AchievementItem> = {}): AchievementItem {
  const definition = ACHIEVEMENT_DEFINITIONS.find((entry) => entry.id === id)!;
  return { definition, earned: null, progress: null, rarity: null, ...patch };
}

const earned = (count: number) => ({ firstDay: "2026-11-01", lastDay: "2026-11-20", count });
const ko = translateFor("ko");
const en = translateFor("en");

describe("achievementSummary", () => {
  it("counts what is held and tallies it by rarity tier, leaving out tiers not held and never the catalogue size", () => {
    const items = [
      item("firstFlow", { earned: earned(1), rarity: { percent: 71, basisCount: 1240 } }),
      item("streak7", { earned: earned(3), rarity: { percent: 41, basisCount: 1240 } }),
      item("noDriftDay", { earned: earned(1), rarity: { percent: 0.7, basisCount: 1240 } }),
      item("comeback", { rarity: { percent: 3.4, basisCount: 1240 } }),
    ];
    expect(achievementSummary(items, ko).text).toBe("업적 3개 · 흔함 2 · 전설 1");
    expect(achievementSummary(items, en).text).toBe("3 achievements · Common 2 · Legendary 1");
  });

  it("falls back to medal metals, richest first, when any held one has no rarity", () => {
    const items = [
      item("flow90", { earned: earned(12) }),
      item("flow180", { earned: earned(14), rarity: { percent: 6.2, basisCount: 1240 } }),
      item("streak7", { earned: earned(2) }),
      item("firstFlow", { earned: earned(1) }),
    ];
    const summary = achievementSummary(items, ko);
    expect(summary.kind).toBe("medal");
    expect(summary.text).toBe("업적 4개 · 금메달 2 · 은메달 2");
  });

  it("reads one held achievement in the singular and has no tally before anything is earned", () => {
    expect(achievementSummary([item("firstFlow", { earned: earned(1) }), item("flow90")], en).text).toBe("1 achievement · Silver 1");
    const none = achievementSummary([item("firstFlow"), item("flow90")], en);
    expect(none.text).toBe("No achievements yet");
    expect(none.parts).toEqual([]);
  });
});
