import { describe, expect, it } from "vitest";
import type { LeaderboardRow } from "./leaderboardService";
import { formatPreciseTopPercentile, getLeaderFocusSeconds, getLeaderShareRatio, getPreciseTopPercentile, getRankGap, getRankTier, getTopPercentile } from "./leaderboardStanding";

function makeRow(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    rank: 1,
    public_id: "public-1",
    display_name: "Alex",
    avatar_url: "",
    period: "weekly",
    focus_seconds: 3600,
    focus_seconds_7d: 3600,
    window_start_date: "2026-09-04",
    window_end_date: "2026-09-10",
    updated_at: "2026-09-10T02:00:00.000Z",
    ...overrides,
  };
}

describe("getRankTier", () => {
  it("maps only the podium to the board's medal tiers", () => {
    expect([getRankTier(1), getRankTier(2), getRankTier(3)]).toEqual(["gold", "silver", "bronze"]);
    expect(getRankTier(4)).toBeNull();
  });
});

describe("getTopPercentile", () => {
  it("rounds up so the leader never reads as top 0%", () => {
    expect(getTopPercentile(1, 1204)).toBe(1);
    expect(getTopPercentile(12, 1204)).toBe(1);
    expect(getTopPercentile(120, 1204)).toBe(10);
  });

  it("suppresses the claim when the participant count cannot support it", () => {
    expect(getTopPercentile(5, null)).toBeNull();
    expect(getTopPercentile(5, undefined)).toBeNull();
    expect(getTopPercentile(5, 4)).toBeNull();
  });
});

describe("getPreciseTopPercentile", () => {
  it("keeps sub-1% standings instead of rounding up to 1%", () => {
    expect(getPreciseTopPercentile(6, 50)).toBe(12);
    expect(getPreciseTopPercentile(6, 600_000)).toBe(0.001);
    expect(formatPreciseTopPercentile(0.001)).toBe("0.001");
  });
});

describe("getLeaderFocusSeconds", () => {
  it("takes the highest total on the same period board", () => {
    const row = makeRow({ rank: 3, focus_seconds: 3600 });
    const rows = [makeRow({ rank: 1, focus_seconds: 7200 }), makeRow({ rank: 2, focus_seconds: 5400 }), row];

    expect(getLeaderFocusSeconds(rows, row)).toBe(7200);
  });

  it("ignores rows from another period and empty boards", () => {
    const row = makeRow({ rank: 2, focus_seconds: 1800 });
    const rows = [makeRow({ rank: 1, period: "monthly", focus_seconds: 99_999 }), row];

    expect(getLeaderFocusSeconds(rows, row)).toBe(1800);
    expect(getLeaderFocusSeconds([], makeRow({ focus_seconds: 0 }))).toBeNull();
  });
});

describe("getLeaderShareRatio", () => {
  it("clamps the meter between an empty board and the leader's own full bar", () => {
    expect(getLeaderShareRatio(3600, 7200)).toBe(0.5);
    expect(getLeaderShareRatio(9000, 7200)).toBe(1);
    expect(getLeaderShareRatio(0, 7200)).toBe(0);
    expect(getLeaderShareRatio(3600, null)).toBeNull();
  });
});

describe("getRankGap", () => {
  it("reports the deficit to the rank above", () => {
    const row = makeRow({ rank: 3, focus_seconds: 3600 });
    const rows = [makeRow({ rank: 1, focus_seconds: 9000 }), makeRow({ rank: 2, focus_seconds: 5400 }), row];

    expect(getRankGap(rows, row)).toEqual({ kind: "chase", seconds: 1800, rivalRank: 2 });
  });

  it("reports the leader's margin over the runner-up", () => {
    const row = makeRow({ rank: 1, focus_seconds: 9000 });
    const rows = [row, makeRow({ rank: 2, focus_seconds: 5400 })];

    expect(getRankGap(rows, row)).toEqual({ kind: "lead", seconds: 3600, rivalRank: 2 });
  });

  it("returns null when the rival row is not loaded", () => {
    const row = makeRow({ rank: 26, focus_seconds: 600 });

    expect(getRankGap([row], row)).toBeNull();
  });
});
