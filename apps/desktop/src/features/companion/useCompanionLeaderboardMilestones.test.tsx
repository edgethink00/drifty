// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCompanionLeaderboardMilestones } from "./useCompanionLeaderboardMilestones";

const mocks = vi.hoisted(() => ({
  fetchOwnEntry: vi.fn(),
  showMilestone: vi.fn().mockResolvedValue(true),
}));

vi.mock("../leaderboard/leaderboardService", () => ({
  fetchOwnLeaderboardEntry: mocks.fetchOwnEntry,
}));

vi.mock("./watcherBridge", () => ({
  isTauriRuntime: () => true,
  showNativeCompanionMilestone: mocks.showMilestone,
}));

describe("useCompanionLeaderboardMilestones", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    mocks.fetchOwnEntry.mockReset();
    mocks.showMilestone.mockClear();
  });

  it("loads the opted-in daily rank and sends a podium event through the native Companion", async () => {
    mocks.fetchOwnEntry.mockResolvedValue({
      success: true,
      error: null,
      data: {
        rank: 2,
        display_name: "Drifty",
        period: "daily",
        focus_seconds: 14_400,
        focus_seconds_7d: 14_400,
        window_start_date: "2026-08-03",
        window_end_date: "2026-08-03",
        timezone: "Asia/Seoul",
        opted_in: true,
        updated_at: "2026-08-03T09:00:00.000Z",
      },
    });

    renderHook(() => useCompanionLeaderboardMilestones({
      ready: true,
      userScopeKey: "user-1",
      day: "2026-08-03",
      startOfWeek: "monday",
      announcementsEnabled: true,
    }));

    await waitFor(() => expect(mocks.showMilestone).toHaveBeenCalledWith(expect.objectContaining({
      id: "companion-leaderboard:daily:2026-08-03:rank2",
      title: "#2 in focus today",
      destination: "leaderboard",
    })));
  });
});
