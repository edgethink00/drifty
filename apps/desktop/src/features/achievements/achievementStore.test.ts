import { describe, expect, it } from "vitest";
import type { AchievementDayFacts } from "./achievementFacts";
import {
  EMPTY_ACHIEVEMENT_STORE,
  forgetAchievementHistory,
  markAchievementsAnnounced,
  mergeAchievementFacts,
  nextAchievementRange,
  readAchievementStore,
  unannouncedAchievements,
  writeAchievementStore,
  ACHIEVEMENT_STORE_KEY,
} from "./achievementStore";

const HOUR = 3600;

function day(dayIso: string, values: Partial<Omit<AchievementDayFacts, "day">> = {}): AchievementDayFacts {
  return { day: dayIso, trackedSeconds: 2 * HOUR, focusSeconds: HOUR, driftSeconds: 0, longestFocusRunSeconds: 0, earlyFocusSeconds: 0, lateFocusSeconds: 0, ...values };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("achievement store", () => {
  it("looks back a year the first time, then rechecks the last two weeks", () => {
    expect(nextAchievementRange(EMPTY_ACHIEVEMENT_STORE, "2026-11-21")).toEqual({ startDay: "2025-11-22", endDay: "2026-11-21" });
    const checked = { ...EMPTY_ACHIEVEMENT_STORE, evaluatedThroughDay: "2026-11-19" };
    expect(nextAchievementRange(checked, "2026-11-21")).toEqual({ startDay: "2026-11-08", endDay: "2026-11-21" });
    expect(nextAchievementRange({ ...checked, evaluatedThroughDay: "2026-11-21" }, "2026-11-21")).toBeNull();
    // After a long absence the gap is filled, but never beyond a year.
    expect(nextAchievementRange({ ...checked, evaluatedThroughDay: "2026-10-01" }, "2026-11-21")).toEqual({ startDay: "2026-10-02", endDay: "2026-11-21" });
  });

  it("keeps an earned achievement when a later correction no longer reaches it", () => {
    const range = { startDay: "2026-11-01", endDay: "2026-11-02" };
    const first = mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [day("2026-11-01", { longestFocusRunSeconds: 2 * HOUR })], range);
    expect(first.earned.flow90).toEqual({ firstDay: "2026-11-01", lastDay: "2026-11-01", count: 1 });
    const corrected = mergeAchievementFacts(first, [day("2026-11-01", { longestFocusRunSeconds: 20 * 60 })], range);
    expect(corrected.earned.flow90).toEqual({ firstDay: "2026-11-01", lastDay: "2026-11-01", count: 1 });
    expect(corrected.facts["2026-11-01"]?.[3]).toBe(20 * 60);
  });

  it("shows what the first look found together once, then one at a time", () => {
    const found = mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [day("2026-11-01", { longestFocusRunSeconds: 30 * 60 })], { startDay: "2026-11-01", endDay: "2026-11-01" });
    expect(found.firstLookPending).toBe(true);
    expect(unannouncedAchievements(found)).toEqual(["firstFlow"]);
    const seen = markAchievementsAnnounced(found, ["firstFlow"]);
    expect(seen.firstLookPending).toBe(false);
    expect(unannouncedAchievements(seen)).toEqual([]);

    const nothing = mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [day("2026-11-01")], { startDay: "2026-11-01", endDay: "2026-11-01" });
    expect(nothing.firstLookPending).toBe(false);
  });

  it("forgets summaries and earned achievements after history is deleted, without announcing them again", () => {
    const range = { startDay: "2026-11-01", endDay: "2026-11-01" };
    const seen = markAchievementsAnnounced(mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [day("2026-11-01", { longestFocusRunSeconds: 30 * 60 })], range), ["firstFlow"]);
    const forgotten = forgetAchievementHistory(seen);
    expect(forgotten.earned).toEqual({});
    expect(forgotten.facts).toEqual({});
    expect(forgotten.evaluatedThroughDay).toBeNull();
    const reearned = mergeAchievementFacts(forgotten, [day("2026-11-01", { longestFocusRunSeconds: 30 * 60 })], range);
    expect(unannouncedAchievements(reearned)).toEqual([]);
    expect(reearned.firstLookPending).toBe(false);
  });

  it("round-trips through storage and ignores damaged entries", () => {
    const storage = memoryStorage();
    const store = mergeAchievementFacts(EMPTY_ACHIEVEMENT_STORE, [day("2026-11-01", { longestFocusRunSeconds: 2 * HOUR })], { startDay: "2026-11-01", endDay: "2026-11-01" });
    writeAchievementStore(store, storage);
    expect(readAchievementStore(storage)).toEqual(store);

    storage.setItem(ACHIEVEMENT_STORE_KEY, JSON.stringify({ ...store, facts: { "2026-11-01": [1, 2], nope: [1, 1, 1, 1, 1, 1] }, earned: { flow90: { firstDay: "x" } } }));
    const damaged = readAchievementStore(storage);
    expect(damaged.facts).toEqual({});
    expect(damaged.earned).toEqual({});
    storage.setItem(ACHIEVEMENT_STORE_KEY, "{not json");
    expect(readAchievementStore(storage)).toEqual(EMPTY_ACHIEVEMENT_STORE);
  });
});

