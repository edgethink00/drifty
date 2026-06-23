import type { ActivitySegment } from "@drifty/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMonthV2Overview } from "./monthOverview";

function makeSegment(id: string, startedAt: Date, endedAt: Date): ActivitySegment {
  return {
    id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
    appName: "Code",
    bundleId: `com.example.${id}`,
    windowTitle: `${id} window`,
    platform: "macos",
    source: "nsworkspace",
  };
}

describe("buildMonthV2Overview", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks today and future days from the logical day boundary", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 22, 1, 30, 0, 0));

    const overview = buildMonthV2Overview([
      makeSegment("logical-today", new Date(2026, 5, 21, 23, 30, 0, 0), new Date(2026, 5, 22, 0, 0, 0, 0)),
      makeSegment("calendar-today-future", new Date(2026, 5, 22, 12, 0, 0, 0), new Date(2026, 5, 22, 12, 30, 0, 0)),
    ], "2026-06-21", undefined, 4 * 60);

    const cells = overview.weeks.flat();
    const logicalToday = cells.find((cell) => cell.isoDay === "2026-06-21");
    const calendarToday = cells.find((cell) => cell.isoDay === "2026-06-22");

    expect(logicalToday).toMatchObject({ isToday: true, isFuture: false, totalSeconds: 1800 });
    expect(calendarToday).toMatchObject({ isToday: false, isFuture: true });
    expect(overview.totalTrackedSeconds).toBe(1800);
  });
});
