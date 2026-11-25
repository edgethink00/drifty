import { describe, expect, it } from "vitest";
import { achievementDefinition } from "./achievementCatalog";
import { achievementHistory, historyEntries, historyFor } from "./achievementHistory";
import { EMPTY_ACHIEVEMENT_STORE, mergeAchievementFacts } from "./achievementStore";
import { buildAchievementItems } from "./useAchievements";

const HOUR = 3600;

function driftDay(day: string) {
  return { day, trackedSeconds: 5 * HOUR, focusSeconds: 60, driftSeconds: 4 * HOUR, longestFocusRunSeconds: 60, earlyFocusSeconds: 0, lateFocusSeconds: 0 };
}

describe("achievementHistory", () => {
  it("lists a repeated achievement's kept days newest first", () => {
    const history = achievementHistory(
      achievementDefinition("driftDay"),
      { firstDay: "2026-11-02", lastDay: "2026-11-09", count: 3 },
      ["2026-11-02", "2026-11-05", "2026-11-09"],
    );
    expect(history).toEqual({ days: ["2026-11-09", "2026-11-05", "2026-11-02"], earlier: 0 });
  });

  it("counts the times beyond the kept days as earlier ones", () => {
    const history = achievementHistory(
      achievementDefinition("flow90"),
      { firstDay: "2024-01-03", lastDay: "2026-11-20", count: 39 },
      ["2026-11-12", "2026-11-20"],
    );
    expect(history).toEqual({ days: ["2026-11-20", "2026-11-12"], earlier: 37 });
    expect(historyEntries(history!)).toEqual([{ day: "2026-11-20", ordinal: 39 }, { day: "2026-11-12", ordinal: 38 }]);
  });

  it("keeps every time as earlier when no earned day is kept any more", () => {
    const history = achievementHistory(achievementDefinition("streak7"), { firstDay: "2024-02-01", lastDay: "2024-06-01", count: 4 }, []);
    expect(history).toEqual({ days: [], earlier: 4 });
  });

  it("gives a one-off achievement only the day it was earned", () => {
    const history = achievementHistory(
      achievementDefinition("firstFlow"),
      { firstDay: "2026-10-01", lastDay: "2026-10-01", count: 1 },
      ["2026-10-01", "2026-10-04", "2026-11-02"],
    );
    expect(history).toEqual({ days: ["2026-10-01"], earlier: 0 });
  });

  it("is absent until the achievement is earned", () => {
    expect(achievementHistory(achievementDefinition("flow180"), null, [])).toBeNull();
    expect(historyFor({ definition: achievementDefinition("flow180"), earned: null })).toBeNull();
  });

  it("falls back to the earned record's first and latest day when no history is attached", () => {
    expect(historyFor({ definition: achievementDefinition("flow90"), earned: { firstDay: "2026-09-01", lastDay: "2026-11-01", count: 12 } }))
      .toEqual({ days: ["2026-11-01", "2026-09-01"], earlier: 10 });
  });

  it("is filled on each item from the days kept on this computer", () => {
    const store = mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [driftDay("2026-11-03"), driftDay("2026-11-05")], { startDay: "2026-11-01", endDay: "2026-11-06" });
    const withEarlier = { ...store, earned: { ...store.earned, driftDay: { firstDay: "2025-01-04", lastDay: "2026-11-05", count: 14 } } };
    const item = buildAchievementItems(withEarlier).find((entry) => entry.definition.id === "driftDay");
    expect(item?.history).toEqual({ days: ["2026-11-05", "2026-11-03"], earlier: 12 });
    expect(buildAchievementItems(withEarlier).find((entry) => entry.definition.id === "flow180")?.history).toBeNull();
  });
});
