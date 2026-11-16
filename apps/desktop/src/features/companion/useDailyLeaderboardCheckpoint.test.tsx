// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDailyLeaderboardCheckpoint } from "./useDailyLeaderboardCheckpoint";

describe("daily leaderboard checkpoint", () => {
  afterEach(() => { cleanup(); window.localStorage.clear(); vi.useRealTimers(); });

  it("retries a transient failure and records only a successful account-scoped publication", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sync = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValueOnce("retry").mockResolvedValue("published");
    const { rerender } = renderHook(({ user }: { user: string }) => useDailyLeaderboardCheckpoint({
      ready: true, day: "2026-08-03", userScopeKey: user, optedIn: false,
      syncPublication: sync, publishCheckpoint: publish,
    }), { initialProps: { user: "one" } });

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(window.localStorage.length).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    await waitFor(() => expect(window.localStorage.getItem("drifty.endOfDayReview.leaderboardCheckpointDate.v2:one")).toBe("2026-08-03"));
    expect(publish).toHaveBeenCalledTimes(2);
    rerender({ user: "two" });
    await waitFor(() => expect(window.localStorage.getItem("drifty.endOfDayReview.leaderboardCheckpointDate.v2:two")).toBe("2026-08-03"));
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it("does not repeatedly contact the service for a nonparticipant, but starts if they join", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sync = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValueOnce("not_participating").mockResolvedValue("published");
    const { rerender } = renderHook(({ optedIn }: { optedIn: boolean }) => useDailyLeaderboardCheckpoint({
      ready: true, day: "2026-08-03", userScopeKey: "one", optedIn,
      syncPublication: sync, publishCheckpoint: publish,
    }), { initialProps: { optedIn: false } });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000); });
    expect(publish).toHaveBeenCalledTimes(1);
    rerender({ optedIn: true });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
  });

  it("waits for an in-flight checkpoint before a review, but no longer than two seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sync = vi.fn().mockResolvedValue(undefined);
    let finish: (value: "published") => void = () => {};
    const publish = vi.fn().mockImplementation(() => new Promise<"published">((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useDailyLeaderboardCheckpoint({
      ready: true, day: "2026-08-03", userScopeKey: "one", optedIn: true,
      syncPublication: sync, publishCheckpoint: publish,
    }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    let done = false;
    const wait = result.current("2026-08-03").then(() => { done = true; });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(done).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await wait;
    expect(done).toBe(true);
    await act(async () => { finish("published"); });
  });

  it("starts the new account after an old account's in-flight request settles", async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    let finish: (value: "published") => void = () => {};
    const publish = vi.fn().mockImplementationOnce(() => new Promise<"published">((resolve) => { finish = resolve; })).mockResolvedValue("published");
    const { rerender } = renderHook(({ user }: { user: string }) => useDailyLeaderboardCheckpoint({
      ready: true, day: "2026-08-03", userScopeKey: user, optedIn: true,
      syncPublication: sync, publishCheckpoint: publish,
    }), { initialProps: { user: "one" } });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    rerender({ user: "two" });
    await act(async () => { finish("published"); });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(window.localStorage.getItem("drifty.endOfDayReview.leaderboardCheckpointDate.v2:two")).toBe("2026-08-03"));
    expect(window.localStorage.getItem("drifty.endOfDayReview.leaderboardCheckpointDate.v2:one")).toBeNull();
  });
});
