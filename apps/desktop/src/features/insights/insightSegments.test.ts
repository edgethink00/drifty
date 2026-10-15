import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildAttentionRhythm } from "./attentionRhythm";
import { selectInsightSegments } from "./insightSegments";

function segmentBetween(id: string, startedAt: string, endedAt: string): ActivitySegment {
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds: Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
    appName: "Code",
    bundleId: "com.example.code",
    windowTitle: "Insight segment test",
    platform: "macos",
    source: "nsworkspace",
    classification: {
      category: "workspace",
      productivity: "focus",
      source: "manual",
      confidence: 1,
      reason: "test",
    },
  };
}

describe("selectInsightSegments", () => {
  it("keeps the final second of the display window separate from the query's inclusive end", () => {
    const crossing = segmentBetween("crossing", "2026-07-03T03:59:00", "2026-07-03T04:01:00");
    const original = JSON.stringify(crossing);
    const selected = selectInsightSegments({
      historySegments: [crossing], selectedDaySegments: [],
      range: { start: "2026-06-26T04:00:00", end: "2026-07-03T03:59:59" },
      endExclusiveMs: Date.parse("2026-07-03T04:00:00"),
    });
    expect(selected[0].durationSeconds).toBe(60);
    expect(JSON.stringify(crossing)).toBe(original);
  });

  it("includes selected-day segments when the history window is missing the selected day", () => {
    const historySegments = [
      segmentBetween("history-monday", "2026-06-29T10:00:00.000", "2026-06-29T11:00:00.000"),
    ];
    const selectedDaySegments = [
      segmentBetween("live-thursday", "2026-07-02T16:00:00.000", "2026-07-02T17:00:00.000"),
    ];

    const segments = selectInsightSegments({
      historySegments,
      selectedDaySegments,
      range: { start: "2026-06-03T00:00:00", end: "2026-07-02T23:59:59" },
    });

    expect(segments.map((segment) => segment.id)).toEqual(["history-monday", "live-thursday"]);
  });

  it("leaves failed Windows foreground captures out of Trends", () => {
    const failedCapture: ActivitySegment = {
      ...segmentBetween("failed-capture", "2026-06-30T09:00:00.000", "2026-06-30T11:00:00.000"),
      appName: "Unavailable",
      bundleId: null,
      platform: "windows",
      source: "unknown",
      classification: null,
    };

    const segments = selectInsightSegments({
      historySegments: [
        segmentBetween("history-monday", "2026-06-29T10:00:00.000", "2026-06-29T11:00:00.000"),
        failedCapture,
      ],
      selectedDaySegments: [],
      range: { start: "2026-06-03T00:00:00", end: "2026-07-02T23:59:59" },
    });

    expect(segments.map((segment) => segment.id)).toEqual(["history-monday"]);
  });

  it("keeps selected-day activity visible in a month attention rhythm", () => {
    const selectedDaySegments = [
      segmentBetween("live-thursday", "2026-07-02T16:00:00.000", "2026-07-02T17:00:00.000"),
    ];
    const segments = selectInsightSegments({
      historySegments: [],
      selectedDaySegments,
      range: { start: "2026-06-03T00:00:00", end: "2026-07-02T23:59:59" },
    });

    const cells = buildAttentionRhythm(segments, undefined, {
      averagingRange: { startDay: "2026-06-03", endDay: "2026-07-02" },
    });

    expect(cells.find((cell) => cell.weekdayIndex === 3 && cell.hour === 16)).toMatchObject({ state: "focus" });
  });

  it("includes recent-week compact segments when the month history window is missing them", () => {
    const historySegments = [
      segmentBetween("older-friday", "2026-06-13T16:00:00.000", "2026-06-13T17:00:00.000"),
    ];
    const recentWeekSegments = [
      segmentBetween("recent-friday", "2026-06-26T09:00:00.000", "2026-06-26T10:00:00.000"),
    ];

    const segments = selectInsightSegments({
      historySegments,
      supplementalSegments: recentWeekSegments,
      selectedDaySegments: [],
      range: { start: "2026-06-03T00:00:00", end: "2026-07-02T23:59:59" },
    });
    const cells = buildAttentionRhythm(segments, undefined, {
      averagingRange: { startDay: "2026-06-03", endDay: "2026-07-02" },
    });

    expect(segments.map((segment) => segment.id)).toEqual(["older-friday", "recent-friday"]);
    expect(cells.find((cell) => cell.weekdayIndex === 4 && cell.hour === 9)).toMatchObject({ state: "focus" });
  });
});
