import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({ event: vi.fn(), daily: vi.fn() }));
vi.mock("../../lib/analytics/posthogClient", () => ({ capturePostHogEvent: capture.event, capturePostHogDailyEvent: capture.daily }));

import type { AchievementId } from "./achievementCatalog";
import {
  achievementCardAnalytics,
  achievementRarityBand,
  reportAchievementCard,
  reportAchievementDetailOpened,
  reportAchievementsTabOpened,
} from "./achievementAnalytics";
import { EMPTY_ACHIEVEMENT_STORE } from "./achievementStore";
import { buildAchievementItems } from "./useAchievements";

const DAY = "2026-11-20";

function itemsWith(earned: readonly AchievementId[], rarity: Partial<Record<AchievementId, number>>) {
  return buildAchievementItems(
    { ...EMPTY_ACHIEVEMENT_STORE, earned: Object.fromEntries(earned.map((id) => [id, { firstDay: DAY, lastDay: DAY, count: 1 }])) },
    Object.fromEntries(Object.entries(rarity).map(([id, percent]) => [id, { percent: percent!, basisCount: 1000 }])),
  );
}

describe("achievement analytics", () => {
  beforeEach(() => {
    capture.event.mockClear();
    capture.daily.mockClear();
  });

  it("bands a share without saying which achievement it is", () => {
    expect([null, 0.5, 1, 9.9, 10, 30, 30.1].map(achievementRarityBand)).toEqual(
      ["unknown", "under_1", "under_10", "under_10", "under_30", "under_30", "over_30"],
    );
  });

  it("describes a card by its kind and the band of the achievement leading it", () => {
    const items = itemsWith(["firstFlow", "streak7", "flow180"], { firstFlow: 71, streak7: 41, flow180: 6 });
    expect(achievementCardAnalytics(items, ["flow180"], false)).toEqual({ card_kind: "single", rarity_band: "under_10" });
    // The first look back leads with the heaviest achievement, as the card does.
    expect(achievementCardAnalytics(items, ["firstFlow", "streak7", "flow180"], true)).toEqual({ card_kind: "first_look", rarity_band: "under_10" });
    expect(achievementCardAnalytics(items, ["firstFlow"], true)).toEqual({ card_kind: "single", rarity_band: "over_30" });
  });

  it("counts the card's showing once a day and the person's choices each time", () => {
    const card = { card_kind: "single", rarity_band: "under_1" } as const;
    reportAchievementCard("card_shown", card);
    reportAchievementCard("card_opened_tab", card);
    reportAchievementCard("card_closed", card);
    expect(capture.daily).toHaveBeenCalledWith("achievement_action", "card_shown:single:under_1", { action: "card_shown", ...card });
    expect(capture.event.mock.calls).toEqual([
      ["achievement_action", { action: "card_opened_tab", ...card }],
      ["achievement_action", { action: "card_closed", ...card }],
    ]);
  });

  it("counts opening the tab and an achievement's details once a day", () => {
    reportAchievementsTabOpened();
    reportAchievementsTabOpened();
    reportAchievementDetailOpened();
    expect(capture.daily.mock.calls).toEqual([
      ["achievement_action", "tab_opened", { action: "tab_opened" }],
      ["achievement_action", "tab_opened", { action: "tab_opened" }],
      ["achievement_action", "detail_opened", { action: "detail_opened" }],
    ]);
    expect(capture.event).not.toHaveBeenCalled();
  });
});
