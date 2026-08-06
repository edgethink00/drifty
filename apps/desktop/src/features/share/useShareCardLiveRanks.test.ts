import { describe, expect, it } from "vitest";
import type { OwnLeaderboardEntry } from "../leaderboard/leaderboardService";
import { resolveShareCardRankState, toShareCardLiveRank } from "./useShareCardLiveRanks";

function ownEntry(overrides: Partial<OwnLeaderboardEntry> = {}): OwnLeaderboardEntry {
  return {
    rank: 1,
    participant_count: 2_858,
    display_name: "Drifty",
    period: "daily",
    focus_seconds: 14_400,
    focus_seconds_7d: 14_400,
    window_start_date: "2026-08-06",
    window_end_date: "2026-08-06",
    timezone: "Asia/Seoul",
    opted_in: true,
    updated_at: "2026-08-06T09:00:00.000Z",
    ...overrides,
  };
}

describe("share card live ranks", () => {
  it("uses the server-provided participant count for the displayed top percentage", () => {
    const rank = toShareCardLiveRank(ownEntry({ rank: 1, participant_count: 2_858 }));

    expect(rank).toEqual({
      rank: 1,
      participantCount: 2_858,
      topPercent: 0.035,
      windowStartDay: "2026-08-06",
      windowEndDay: "2026-08-06",
    });
  });

  it("fails closed rather than inventing a percentile without a participant count", () => {
    expect(toShareCardLiveRank(ownEntry({ participant_count: null }))).toBeNull();
    expect(resolveShareCardRankState({ success: true, error: null, data: ownEntry({ participant_count: null }) }).availability).toBe("unavailable");
  });

  it("keeps rank cards locked when the member has not opted in", () => {
    expect(resolveShareCardRankState({ success: true, error: null, data: ownEntry({ opted_in: false }) }).availability).toBe("not_joined");
  });
});
