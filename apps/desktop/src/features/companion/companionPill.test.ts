// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { formatPillDuration, resolveCollapsedState } from "./CompanionPillCollapsed";
import {
  COMPANION_PILL_SIZES,
  resolveCompanionHorizontalAnchor,
} from "./companionPillLayout";
import type { WatcherPeekEvent } from "./watcherPeekTypes";

function buildPeekEvent(overrides: Partial<WatcherPeekEvent> = {}): WatcherPeekEvent {
  return {
    id: 1,
    productivity: "focus",
    category: "workspace",
    contextLabel: "VS Code",
    durationLabel: "6m",
    durationSeconds: 360,
    slotIndex: 0,
    focusSessionKind: "settled",
    driftPattern: "first",
    driftReminderElapsedSeconds: null,
    recentWatcherResponse: null,
    minutesSinceLastWatcher: null,
    focusSecondsToday: 15_120,
    currentHourFocusSeconds: 600,
    ...overrides,
  };
}

describe("formatPillDuration", () => {
  it("reads as a clock so the digits keep a fixed width", () => {
    expect(formatPillDuration(15_120)).toBe("4:12");
    expect(formatPillDuration(360)).toBe("6:00");
    expect(formatPillDuration(0)).toBe("0:00");
  });

  it("never renders a negative duration", () => {
    expect(formatPillDuration(-30)).toBe("0:00");
  });
});

describe("resolveCollapsedState", () => {
  it("shows the day's focus total when nothing else is worth saying", () => {
    expect(resolveCollapsedState(buildPeekEvent({ durationSeconds: 60 }), false)).toEqual({
      kind: "total",
      primary: "4:12",
      suffix: "focused",
    });
  });

  it("names a focus run only once it is long enough to lose", () => {
    const state = resolveCollapsedState(buildPeekEvent({
      durationSeconds: 120,
      focusStrikeSeconds: 1_441,
    }), false);
    expect(state.kind).toBe("streak");
    expect(state.suffix).toBe("streak");
    expect(state.primary).toBe("24:01");
  });

  it("counts down to the alarm while a drift is still in its grace period", () => {
    const state = resolveCollapsedState(
      buildPeekEvent({ productivity: "drift", durationSeconds: 46 }),
      false,
    );
    expect(state).toEqual({ kind: "drift-grace", primary: "0:14", suffix: "to alarm" });
  });

  it("reports elapsed drift once the alarm has already fired", () => {
    const state = resolveCollapsedState(
      buildPeekEvent({ productivity: "drift", durationSeconds: 750 }),
      false,
    );
    expect(state).toEqual({ kind: "drifting", primary: "12:30", suffix: "off track" });
  });

  it("says so plainly instead of showing a frozen number while paused", () => {
    const state = resolveCollapsedState(buildPeekEvent(), true);
    expect(state).toEqual({ kind: "paused", primary: "4:12", suffix: "paused" });
  });

  it("falls back to zero before the first event arrives", () => {
    expect(resolveCollapsedState(null, false)).toEqual({
      kind: "total",
      primary: "0:00",
      suffix: "focused",
    });
  });
});

describe("companion pill geometry", () => {
  it("centers a card unless that centered card would cross a screen edge", () => {
    const base = { targetCapsuleWidth: 410, screenLeft: 0, screenWidth: 1728 };
    expect(resolveCompanionHorizontalAnchor({ ...base, capsuleCenterX: 864 }))
      .toBe("center");
    expect(resolveCompanionHorizontalAnchor({ ...base, capsuleCenterX: 1594 }))
      .toBe("right");
    expect(resolveCompanionHorizontalAnchor({ ...base, capsuleCenterX: 134 }))
      .toBe("left");
  });

  it("keeps the measured milestone compact after adding its trailing stat", () => {
    expect(COMPANION_PILL_SIZES.milestone).toEqual({ width: 410, height: 54 });
  });

  it("keeps the resting capsule the smallest state", () => {
    const heights = Object.values(COMPANION_PILL_SIZES).map((size) => size.height);
    expect(COMPANION_PILL_SIZES.collapsed.height).toBe(Math.min(...heights));
  });

  it("gives the day review the most room, since it carries the most content", () => {
    const heights = Object.values(COMPANION_PILL_SIZES).map((size) => size.height);
    expect(COMPANION_PILL_SIZES.eod.height).toBe(Math.max(...heights));
  });

  it("fits a pending day review to its reduced raw-data content", () => {
    expect(COMPANION_PILL_SIZES.eodPending).toEqual({ width: 331, height: 300 });
  });

  it("keeps Compact v2 aligned with the reviewed prototype geometry", () => {
    expect(COMPANION_PILL_SIZES.eodCompact).toEqual({ width: 310, height: 306 });
  });

  it("removes the focus-pattern row from V3 geometry", () => {
    expect(COMPANION_PILL_SIZES.eodMinimal).toEqual({ width: 310, height: 245 });
  });
});
