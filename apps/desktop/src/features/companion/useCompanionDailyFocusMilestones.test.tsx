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
      { initialProps: { focusSecondsToday: 3_599 } },
    );

    rerender({ focusSecondsToday: 3_600 });

    expect(bridge.showMilestone).toHaveBeenCalledOnce();
    expect(bridge.showMilestone).toHaveBeenCalledWith(expect.objectContaining({
      id: "companion-daily-focus:2026-08-03:day1h",
      statSeconds: 3_600,
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
      { initialProps: { focusSecondsToday: 3_599, announcementsEnabled: false } },
    );

    rerender({ focusSecondsToday: 3_600, announcementsEnabled: false });
    rerender({ focusSecondsToday: 3_601, announcementsEnabled: true });

    expect(bridge.showMilestone).not.toHaveBeenCalled();
  });
});
