// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const shares = vi.hoisted(() => ({ table: {} as Record<string, { percent: number; basisCount: number }> }));
vi.mock("./achievementRaritySource", () => ({ useAchievementRarity: () => shares.table }));

import { useAchievements } from "./useAchievements";

function snapshot() {
  const { result } = renderHook(() => useAchievements({
    enabled: false,
    todayDay: "2026-11-26",
    startOfDayMinutes: 0,
    classificationOptions: {} as never,
    loadHistory: async () => ({ segments: [] }) as never,
  }));
  return result.current.snapshot;
}

describe("announcing achievements", () => {
  afterEach(() => { shares.table = {}; });

  it("holds new-achievement cards until shares of users exist, then lets them through with the shares", () => {
    expect(snapshot().announceReady).toBe(false);
    shares.table = { flow90: { percent: 34, basisCount: 1240 } };
    const ready = snapshot();
    expect(ready.announceReady).toBe(true);
    expect(ready.items.find((item) => item.definition.id === "flow90")?.rarity).toEqual({ percent: 34, basisCount: 1240 });
  });
});
