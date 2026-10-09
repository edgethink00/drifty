// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEADERBOARD_SERIES_PREWARM_DELAY_MS, useLeaderboardSeriesPrewarm } from "./useLeaderboardSeriesPrewarm";

describe("useLeaderboardSeriesPrewarm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns on once after the launch delay for people on the leaderboard", () => {
    const { result } = renderHook(() => useLeaderboardSeriesPrewarm(true));
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(LEADERBOARD_SERIES_PREWARM_DELAY_MS - 1);
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe(true);
  });

  it("never turns on for people who are not on the leaderboard", () => {
    const { result } = renderHook(() => useLeaderboardSeriesPrewarm(false));
    act(() => {
      vi.advanceTimersByTime(LEADERBOARD_SERIES_PREWARM_DELAY_MS * 3);
    });
    expect(result.current).toBe(false);
  });

  it("starts the delay when someone joins later", () => {
    const { result, rerender } = renderHook(({ eligible }) => useLeaderboardSeriesPrewarm(eligible), { initialProps: { eligible: false } });
    act(() => {
      vi.advanceTimersByTime(LEADERBOARD_SERIES_PREWARM_DELAY_MS * 2);
    });
    expect(result.current).toBe(false);

    rerender({ eligible: true });
    act(() => {
      vi.advanceTimersByTime(LEADERBOARD_SERIES_PREWARM_DELAY_MS + 50);
    });
    expect(result.current).toBe(true);
  });
});
