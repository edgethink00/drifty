import { describe, expect, it } from "vitest";
import type { AchievementId } from "./achievementCatalog";
import { achievementAnnouncement } from "./achievementAnnouncement";
import type { AchievementRarity } from "./achievementRarity";
import { EMPTY_ACHIEVEMENT_STORE } from "./achievementStore";
import { buildAchievementItems } from "./useAchievements";

const DAY = "2026-11-20";

function itemsWith(earned: readonly AchievementId[], rarity: Partial<Record<AchievementId, number>>) {
  const shares: Partial<Record<AchievementId, AchievementRarity>> = {};
  for (const [id, percent] of Object.entries(rarity)) shares[id as AchievementId] = { percent: percent!, basisCount: 1000 };
  return buildAchievementItems(
    { ...EMPTY_ACHIEVEMENT_STORE, earned: Object.fromEntries(earned.map((id) => [id, { firstDay: DAY, lastDay: DAY, count: 1 }])) },
    shares,
  );
}

describe("achievementAnnouncement", () => {
  it("opens no card when every new achievement is held by more than 30%", () => {
    const items = itemsWith(["firstFlow", "streak7", "flow90"], { firstFlow: 71, streak7: 41, flow90: 30.1 });
    expect(achievementAnnouncement(items, ["firstFlow", "streak7", "flow90"], false)).toBeNull();
  });

  it("cards an achievement held by exactly 30%", () => {
    const items = itemsWith(["flow90"], { flow90: 30 });
    expect(achievementAnnouncement(items, ["flow90"], false)).toEqual({ ids: ["flow90"], firstLook: false });
  });

  it("leads with only the rarest card-worthy one, leaving common ones out", () => {
    const items = itemsWith(["flow90", "weekendShift", "noDriftDay"], { flow90: 34, weekendShift: 15, noDriftDay: 0.7 });
    expect(achievementAnnouncement(items, ["flow90", "weekendShift", "noDriftDay"], false)).toEqual({ ids: ["noDriftDay"], firstLook: false });
  });

  it("breaks a tie in share by the heavier achievement", () => {
    const items = itemsWith(["earlyStart", "streak30"], { earlyStart: 4, streak30: 4 });
    expect(achievementAnnouncement(items, ["earlyStart", "streak30"], false)?.ids).toEqual(["streak30"]);
  });

  it("opens no card for an achievement whose share is unknown", () => {
    const items = itemsWith(["flow180"], {});
    expect(achievementAnnouncement(items, ["flow180"], false)).toBeNull();
  });

  it("ignores ids that are not earned or already shown", () => {
    const items = itemsWith(["flow180"], { flow180: 6, streak30: 4 });
    expect(achievementAnnouncement(items, ["streak30"], false)).toBeNull();
    expect(achievementAnnouncement(items, [], false)).toBeNull();
  });

  it("keeps the first look back whole, common achievements included", () => {
    const items = itemsWith(["firstFlow", "streak7", "flow180"], { firstFlow: 71, streak7: 41, flow180: 6 });
    expect(achievementAnnouncement(items, ["firstFlow", "streak7", "flow180"], true)).toEqual({
      ids: ["firstFlow", "flow180", "streak7"],
      firstLook: true,
    });
  });

  it("treats a single first find like any new achievement", () => {
    const items = itemsWith(["firstFlow"], { firstFlow: 71 });
    expect(achievementAnnouncement(items, ["firstFlow"], true)).toBeNull();
  });
});
