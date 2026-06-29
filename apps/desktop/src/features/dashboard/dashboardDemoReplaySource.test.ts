import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import {
  buildDashboardReplayFixtureFromSegments,
  buildSelectedDashboardReplayAnchor,
} from "./dashboardDemoReplaySource";

function sourceSegment(input: {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
  readonly appName: string;
}): ActivitySegment {
  return {
    id: input.id,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationSeconds: input.durationSeconds,
    appName: input.appName,
    bundleId: `com.drifty.actual.${input.id}`,
    windowTitle: `${input.appName} window`,
    platform: "macos",
    source: "manual",
    classification: {
      category: "workspace",
      productivity: "focus",
      source: "manual",
      confidence: 1,
      reason: "Actual selected replay source.",
    },
  };
}

describe("dashboard demo replay source", () => {
  it("Given selected day segments When fixture is built Then actual segments are clamped and preserved", () => {
    const anchor = buildSelectedDashboardReplayAnchor({
      kind: "day",
      anchorDay: "2026-06-18",
      startDay: "2026-06-18",
      endDay: "2026-06-18",
      startOfDayMinutes: 240,
    });
    const segments = [
      sourceSegment({
        id: "overlapping-start",
        startedAt: "2026-06-18T03:30:00",
        endedAt: "2026-06-18T04:15:00",
        durationSeconds: 45 * 60,
        appName: "Actual Early Studio",
      }),
      sourceSegment({
        id: "actual-focus",
        startedAt: "2026-06-18T10:00:00",
        endedAt: "2026-06-18T10:05:00",
        durationSeconds: 5 * 60,
        appName: "Actual Focus Studio",
      }),
      sourceSegment({
        id: "outside-range",
        startedAt: "2026-06-19T04:00:00",
        endedAt: "2026-06-19T04:15:00",
        durationSeconds: 15 * 60,
        appName: "Outside Studio",
      }),
    ];

    const fixture = buildDashboardReplayFixtureFromSegments({ anchor, segments });

    expect(fixture.kind).toBe("day");
    expect(fixture.anchor).toBe(anchor);
    expect(fixture.totalSeconds).toBe(20 * 60);
    expect(fixture.segments.map((segment) => segment.appName)).toEqual(["Actual Early Studio", "Actual Focus Studio"]);
    expect(fixture.segments[0]).toMatchObject({
      id: "overlapping-start",
      startedAt: "2026-06-18T04:00:00",
      endedAt: "2026-06-18T04:15:00",
      durationSeconds: 15 * 60,
      bundleId: "com.drifty.actual.overlapping-start",
    });
  });

  it("Given a selected week range When the anchor is built Then it follows the selected dashboard range", () => {
    const anchor = buildSelectedDashboardReplayAnchor({
      kind: "week",
      anchorDay: "2026-06-18",
      startDay: "2026-06-15",
      endDay: "2026-06-21",
      startOfDayMinutes: 240,
    });

    expect(anchor).toEqual({
      kind: "week",
      anchorDay: "2026-06-18",
      startDay: "2026-06-15",
      endDay: "2026-06-21",
      rangeStart: "2026-06-15T04:00:00",
      rangeEnd: "2026-06-22T03:59:59",
      startOfDayMinutes: 240,
    });
  });
});
