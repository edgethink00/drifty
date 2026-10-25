import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";

import { teamFocusDayTotals } from "./teamFocusPublish";

// Safari on stackoverflow.com classifies as focus (as in focusCardPublisher.test).
function segment(day: string, seconds: number, overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  const startedAt = new Date(day + "T09:00:00.000Z");
  return {
    id: day + "-" + seconds + "-" + (overrides.deviceId ?? overrides.source ?? "local"),
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + seconds * 1000).toISOString(),
    durationSeconds: seconds,
    appName: "Safari",
    siteDomain: "stackoverflow.com",
    siteTitle: "Developer docs",
    platform: "macos",
    source: "nsworkspace",
    ...overrides,
  };
}

describe("teamFocusDayTotals", () => {
  const window = { start_date: "2026-10-19", end_date: "2026-10-21" };

  it("sends focus per day in the window and nothing for days without it", () => {
    const entries = teamFocusDayTotals([segment("2026-10-19", 3600), segment("2026-10-21", 1800), segment("2026-10-15", 900)], window, { includeAiClassifications: false }, 0);
    expect(entries).toEqual([
      { activity_date: "2026-10-19", seconds: 3600 },
      { activity_date: "2026-10-21", seconds: 1800 },
    ]);
  });

  it("leaves out other devices' time and imported browser history, as the focus card does", () => {
    const entries = teamFocusDayTotals([
      segment("2026-10-20", 1200),
      segment("2026-10-20", 3600, { deviceId: "windows-pc" }),
      segment("2026-10-20", 2400, { source: "browser-history-import" }),
    ], window, { includeAiClassifications: false }, 0);
    expect(entries).toEqual([{ activity_date: "2026-10-20", seconds: 1200 }]);
  });
});
