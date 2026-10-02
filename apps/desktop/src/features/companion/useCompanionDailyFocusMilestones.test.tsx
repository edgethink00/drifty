// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCompanionDailyFocusMilestones } from "./useCompanionDailyFocusMilestones";

const bridge = vi.hoisted(() => ({
  showMilestone: vi.fn().mockResolvedValue(true),
}));

vi.mock("./watcherBridge", () => ({
  isTauriRuntime: () => true,
  showNativeCompanionMilestone: bridge.showMilestone,
}));

describe("useCompanionDailyFocusMilestones", () => {
  afterEach(() => {
    cleanup();
    bridge.showMilestone.mockClear();
    window.localStorage.clear();
  });

  it("sends a newly crossed live milestone to the native Companion", () => {
    const { rerender } = renderHook(
      (props: { focusSecondsToday: number }) => useCompanionDailyFocusMilestones({
        ready: true,
        day: "2026-08-03",
        focusSecondsToday: props.focusSecondsToday,
        announcementsEnabled: true,
      }),
      { initialProps: { focusSecondsToday: 10_799 } },
    );

    rerender({ focusSecondsToday: 10_800 });

    expect(bridge.showMilestone).toHaveBeenCalledOnce();
    expect(bridge.showMilestone).toHaveBeenCalledWith(expect.objectContaining({
      id: "companion-daily-focus:2026-08-03:day3h",
      statSeconds: 10_800,
    }));
  });

  it("does not catch up after a crossing that was muted because tracking was stopped", () => {
    const { rerender } = renderHook(
      (props: { focusSecondsToday: number; announcementsEnabled: boolean }) => (
        useCompanionDailyFocusMilestones({
          ready: true,
          day: "2026-08-03",
          focusSecondsToday: props.focusSecondsToday,
          announcementsEnabled: props.announcementsEnabled,
        })
      ),
      { initialProps: { focusSecondsToday: 10_799, announcementsEnabled: false } },
    );

    rerender({ focusSecondsToday: 10_800, announcementsEnabled: false });
    rerender({ focusSecondsToday: 10_801, announcementsEnabled: true });

    expect(bridge.showMilestone).not.toHaveBeenCalled();
  });

  /* A stale-day total that arrives under an unchanged day reads as a live
     crossing: the baseline was taken while today was still empty, and the
     same-day path has no rollover reset to absorb the jump. This is the shape
     behind a "3 hours of focus" alert on a day that never had one. */
  it("announces a stale-day total when the caller keeps vouching for it", () => {
    const { rerender } = renderHook(
      (props: { focusSecondsToday: number }) => (
        useCompanionDailyFocusMilestones({
          ready: true,
          day: "2026-08-15",
          focusSecondsToday: props.focusSecondsToday,
          announcementsEnabled: true,
        })
      ),
      { initialProps: { focusSecondsToday: 0 } },
    );

    // The loaded segments still describe the previous day (3h06m of focus).
    rerender({ focusSecondsToday: 11_160 });

    expect(bridge.showMilestone).toHaveBeenCalledOnce();
  });

  /* Readiness is the caller's promise that the figure describes the evaluated
     day. Withdrawing it for the mismatched window must discard the baseline
     rather than bridge across the gap, so the stale total is never announced
     and the correct, much smaller total does not read as a crossing either. */
  it("does not announce a stale-day total once the caller withdraws readiness", () => {
    const { rerender } = renderHook(
      (props: { ready: boolean; focusSecondsToday: number }) => (
        useCompanionDailyFocusMilestones({
          ready: props.ready,
          day: "2026-08-15",
          focusSecondsToday: props.focusSecondsToday,
          announcementsEnabled: true,
        })
      ),
      // Launch: today is empty, so the baseline records zero.
      { initialProps: { ready: true, focusSecondsToday: 0 } },
    );

    // The loaded segments now describe the *previous* day (3h06m of focus). The
    // caller detects the mismatch and withdraws readiness for that window.
    rerender({ ready: false, focusSecondsToday: 11_160 });
    expect(bridge.showMilestone).not.toHaveBeenCalled();

    // Today's real segments land: only a few minutes of focus.
    rerender({ ready: true, focusSecondsToday: 180 });
    rerender({ ready: true, focusSecondsToday: 240 });

    expect(bridge.showMilestone).not.toHaveBeenCalled();
  });

  it("still announces a genuine crossing after readiness returns", () => {
    const { rerender } = renderHook(
      (props: { ready: boolean; focusSecondsToday: number }) => (
        useCompanionDailyFocusMilestones({
          ready: props.ready,
          day: "2026-08-15",
          focusSecondsToday: props.focusSecondsToday,
          announcementsEnabled: true,
        })
      ),
      { initialProps: { ready: false, focusSecondsToday: 0 } },
    );

    rerender({ ready: true, focusSecondsToday: 10_740 });
    rerender({ ready: true, focusSecondsToday: 10_800 });

    expect(bridge.showMilestone).toHaveBeenCalledOnce();
    expect(bridge.showMilestone).toHaveBeenCalledWith(expect.objectContaining({
      id: "companion-daily-focus:2026-08-15:day3h",
    }));
  });
});
