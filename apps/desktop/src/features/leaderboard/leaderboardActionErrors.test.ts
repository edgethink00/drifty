import { describe, expect, it } from "vitest";
import { describeLeaderboardActionError } from "./leaderboardActionErrors";

const t = (key: string) => key;

describe("describeLeaderboardActionError", () => {
  it("translates the English service failures for join and leave", () => {
    expect(describeLeaderboardActionError(new Error("Supabase is not configured"), "leave", t as never)).toBe("leaderboard.error.unavailable");
    expect(describeLeaderboardActionError(new TypeError("Failed to fetch"), "join", t as never)).toBe("leaderboard.error.network");
    expect(describeLeaderboardActionError("Not authenticated", "join", t as never)).toBe("leaderboard.error.signInRequired");
    expect(describeLeaderboardActionError("permission denied for table", "leave", t as never)).toBe("leaderboard.error.leaveFailed");
    expect(describeLeaderboardActionError(null, "join", t as never)).toBe("leaderboard.error.joinFailed");
  });
});

