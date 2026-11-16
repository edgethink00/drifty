// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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
    mocks.showMilestone.mockReset().mockResolvedValue(true);
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

  it("retries a failed native delivery without consuming the weekly result", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-03T09:05:00+09:00"));
    mocks.fetchCheckpoint.mockResolvedValue({
      success: true,
      data: { rank: 1, participant_count: 14, period: "weekly", focus_seconds: 58_000, window_end_date: "2026-08-02", opted_in: true },
    });
    mocks.showMilestone.mockRejectedValueOnce(new Error("surface unavailable")).mockResolvedValue(true);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() => useCompanionLeaderboardMilestones({
      ready: true, userScopeKey: "user-1", calendarDay: "2026-08-03",
      startOfDayMinutes: 0, startOfWeek: "monday", announcementsEnabled: true,
      publishCheckpoint: mocks.publishCheckpoint,
    }));

    await waitFor(() => expect(mocks.showMilestone).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem("drifty.companion.leaderboardCelebrations.v2")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    await waitFor(() => expect(mocks.showMilestone).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(window.localStorage.getItem("drifty.companion.leaderboardCelebrations.v2")).toContain('"lastWeeklyWindowEndDay":"2026-08-02"'));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(mocks.showMilestone).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });

  it("does not invoke the same card twice when the producer rerenders during delivery", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-03T09:05:00+09:00"));
    mocks.fetchCheckpoint.mockResolvedValue({
      success: true,
      data: { rank: 1, participant_count: 14, period: "weekly", focus_seconds: 58_000, window_end_date: "2026-08-02", opted_in: true },
    });
    let finish: (delivered: boolean) => void = () => {};
    mocks.showMilestone.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { rerender } = renderHook(({ publish }: { publish: typeof mocks.publishCheckpoint }) => useCompanionLeaderboardMilestones({
      ready: true, userScopeKey: "user-1", calendarDay: "2026-08-03",
      startOfDayMinutes: 0, startOfWeek: "monday", announcementsEnabled: true,
      publishCheckpoint: publish,
    }), { initialProps: { publish: mocks.publishCheckpoint } });
    await waitFor(() => expect(mocks.showMilestone).toHaveBeenCalledTimes(1));
    rerender({ publish: vi.fn().mockResolvedValue(true) });
    await waitFor(() => expect(mocks.fetchCheckpoint).toHaveBeenCalledTimes(2));
    expect(mocks.showMilestone).toHaveBeenCalledTimes(1);
    await act(async () => { finish(true); });
    await waitFor(() => expect(window.localStorage.getItem("drifty.companion.leaderboardCelebrations.v2")).toContain('"lastWeeklyWindowEndDay":"2026-08-02"'));
  });

  it("stores a recovered weekly result without replaying it as a milestone", async () => {
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

    const { rerender } = renderHook(
      (props: { ready: boolean; recoveryPending: boolean }) => useCompanionLeaderboardMilestones({
        ready: props.ready,
        recoveryPending: props.recoveryPending,
        userScopeKey: "user-1",
        calendarDay: "2026-08-03",
        startOfDayMinutes: 0,
        startOfWeek: "monday",
        announcementsEnabled: true,
        publishCheckpoint: mocks.publishCheckpoint,
      }),
      { initialProps: { ready: false, recoveryPending: true } },
    );

    rerender({ ready: true, recoveryPending: false });

    await waitFor(() => expect(mocks.fetchCheckpoint).toHaveBeenCalledWith("weekly", "2026-08-02"));
    expect(mocks.showMilestone).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("drifty.companion.leaderboardCelebrations.v2"))
      .toContain('"lastWeeklyWindowEndDay":"2026-08-02"');
  });

  it("keeps a pre-result recovery suppressed until the weekly result becomes final", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-03T08:59:00+09:00"));
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

    const { rerender } = renderHook(
      (props: { ready: boolean; recoveryPending: boolean }) => useCompanionLeaderboardMilestones({
        ready: props.ready,
        recoveryPending: props.recoveryPending,
        userScopeKey: "user-1",
        calendarDay: "2026-08-03",
        startOfDayMinutes: 0,
        startOfWeek: "monday",
        announcementsEnabled: true,
        publishCheckpoint: mocks.publishCheckpoint,
      }),
      { initialProps: { ready: false, recoveryPending: true } },
    );

    rerender({ ready: true, recoveryPending: false });
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    await waitFor(() => expect(mocks.fetchCheckpoint).toHaveBeenCalledWith("weekly", "2026-08-02"));
    expect(mocks.showMilestone).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("drifty.companion.leaderboardCelebrations.v2"))
      .toContain('"lastWeeklyWindowEndDay":"2026-08-02"');
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
