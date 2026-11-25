import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_DEFINITIONS, type AchievementId } from "./achievementCatalog";
import { achievementRowParts } from "./achievementRows";
import type { AchievementItem } from "./useAchievements";

function item(id: AchievementId, patch: Partial<AchievementItem> = {}): AchievementItem {
  const definition = ACHIEVEMENT_DEFINITIONS.find((entry) => entry.id === id)!;
  return { definition, earned: null, progress: null, rarity: null, ...patch };
}

const earned = (lastDay: string, count = 1) => ({ firstDay: count === 1 ? lastDay : "2026-01-05", lastDay, count });
const rarity = (percent: number) => ({ percent, basisCount: 1240 });

const ITEMS = [
  item("firstFlow", { earned: earned("2026-11-02"), rarity: rarity(71) }),
  item("flow90", { earned: earned("2026-11-20", 12), rarity: rarity(34) }),
  item("flow180", { progress: { current: 2, target: 3, unit: "seconds" } }),
  item("focusDay8h", { progress: { current: 1, target: 8, unit: "seconds" } }),
  item("streak7", { progress: { current: 5, target: 7, unit: "days" } }),
  item("weekendShift"),
  item("driftDay", { earned: earned("2026-11-10", 3), rarity: rarity(2.3) }),
  item("noDriftDay", { rarity: rarity(0.7) }),
  item("comeback", { earned: earned("2026-10-01"), rarity: rarity(3.4) }),
];

const ids = (items: readonly AchievementItem[]) => items.map((entry) => entry.definition.id);

describe("achievementRowParts", () => {
  it("puts each achievement in one part: under way, earned, not yet, hidden", () => {
    const parts = achievementRowParts(ITEMS, { almost: 2 });
    expect(parts.almost.map((entry) => entry.item.definition.id)).toEqual(["streak7", "flow180"]);
    expect(ids(parts.earned)).toEqual(["flow90", "driftDay", "firstFlow", "comeback"]);
    expect(ids(parts.notYet)).toEqual(["focusDay8h", "weekendShift"]);
    expect(ids(parts.hidden)).toEqual(["noDriftDay"]);
  });

  it("orders earned rows rarest first or most times first", () => {
    expect(ids(achievementRowParts(ITEMS, { earned: "rarest" }).earned)).toEqual(["driftDay", "comeback", "flow90", "firstFlow"]);
    expect(ids(achievementRowParts(ITEMS, { earned: "most" }).earned)).toEqual(["flow90", "driftDay", "firstFlow", "comeback"]);
  });

  it("leaves every under-way goal in not yet when nothing leads", () => {
    const parts = achievementRowParts(ITEMS, { almost: 0 });
    expect(parts.almost).toEqual([]);
    expect(ids(parts.notYet)).toEqual(["streak7", "flow180", "focusDay8h", "weekendShift"]);
  });
});
