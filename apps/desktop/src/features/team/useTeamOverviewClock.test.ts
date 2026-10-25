// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isWithinTeamRecordingHours } from "./teamManagedHours";
import { useTeamOverviewClock } from "./useTeamOverviewClock";

afterEach(() => vi.useRealTimers());

describe("useTeamOverviewClock", () => {
  it("updates live recording hours while the same screen stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T21:15:50Z"));
    const schedule = { days: [1], start_minute: 376, end_minute: 406, timezone: "Asia/Seoul" };
    const { result, unmount } = renderHook(() => useTeamOverviewClock(0, false));
    expect(isWithinTeamRecordingHours(schedule, result.current.nowMs)).toBe(false);
    act(() => vi.advanceTimersByTime(30_000));
    expect(isWithinTeamRecordingHours(schedule, result.current.nowMs)).toBe(true);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a review scenario fixed without polling", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTeamOverviewClock(0, true));
    const initial = result.current.nowMs;
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.nowMs).toBe(initial);
    expect(vi.getTimerCount()).toBe(0);
  });
});
