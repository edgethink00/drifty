// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCompanionLeaderboardMilestones } from "./useCompanionLeaderboardMilestones";

const mocks = vi.hoisted(() => ({
  fetchCheckpoint: vi.fn(),
  publishCheckpoint: vi.fn().mockResolvedValue(true),
  showMilestone: vi.fn().mockResolvedValue(true),
}));

vi.mock("../leaderboard/leaderboardService", () => ({
  fetchOwnLeaderboardCheckpoint: mocks.fetchCheckpoint,
}));

vi.mock("./watcherBridge", () => ({
  isTauriRuntime: () => true,
  showNativeCompanionMilestone: mocks.showMilestone,
}));

describe("useCompanionLeaderboardMilestones", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    mocks.fetchCheckpoint.mockReset();
    mocks.publishCheckpoint.mockReset();
    mocks.publishCheckpoint.mockResolvedValue(true);
    mocks.showMilestone.mockClear();
    vi.useRealTimers();
  });

  it("loads one finalized weekly result after 9 AM on the following day", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-03T09:05:00+09:00"));
    mocks.fetchCheckpoint.mockResolvedValue({
      success: true,
      error: null,
      data: {
        rank: 2,
        participant_count: 14,
        display_name: "Drifty",
        period: "weekly",
        focus_seconds: 58_000,
        focus_seconds_7d: 58_000,
        window_start_date: "2026-07-27",
        window_end_date: "2026-08-02",
        timezone: "Asia/Seoul",
        opted_in: true,
        updated_at: "2026-08-02T14:00:00.000Z",
      },
    });

    renderHook(() => useCompanionLeaderboardMilestones({
      ready: true,
      userScopeKey: "user-1",
      calendarDay: "2026-08-03",
      startOfDayMinutes: 0,
      startOfWeek: "monday",
      announcementsEnabled: true,
      publishCheckpoint: mocks.publishCheckpoint,
    }));

    await waitFor(() => expect(mocks.publishCheckpoint).toHaveBeenCalledWith("weekly", "2026-08-02"));
    await waitFor(() => expect(mocks.fetchCheckpoint).toHaveBeenCalledWith("weekly", "2026-08-02"));
    expect(mocks.showMilestone).toHaveBeenCalledWith(expect.objectContaining({
      id: "companion-leaderboard-final:weekly:2026-08-02:rank2",
      title: "#2 in focus last week",
    }));
  });

  it("does not fetch the just-closed weekly result before 9 AM", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-03T08:59:00+09:00"));

    renderHook(() => useCompanionLeaderboardMilestones({
      ready: true,
      userScopeKey: "user-1",
      calendarDay: "2026-08-03",
      startOfDayMinutes: 0,
      startOfWeek: "monday",
      announcementsEnabled: true,
      publishCheckpoint: mocks.publishCheckpoint,
    }));

    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.fetchCheckpoint).not.toHaveBeenCalled();
    expect(mocks.showMilestone).not.toHaveBeenCalled();
  });

  it("waits until a late logical day boundary before finalizing the closed week", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-03T09:05:00+09:00"));

    renderHook(() => useCompanionLeaderboardMilestones({
      ready: true,
      userScopeKey: "user-1",
      calendarDay: "2026-08-03",
      startOfDayMinutes: 12 * 60,
      startOfWeek: "monday",
      announcementsEnabled: true,
      publishCheckpoint: mocks.publishCheckpoint,
    }));

    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.publishCheckpoint).not.toHaveBeenCalled();
    expect(mocks.fetchCheckpoint).not.toHaveBeenCalled();
  });
});
