import { logicalDayIsoDateForDate, type ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildHistoryDayGroups, buildHistoryRows, buildHistoryRowsWindow, historyRowTitle } from "./historyGroups";

function historySegment(
  id: string,
  startedAt: string,
  endedAt: string,
  durationSeconds: number,
  options: Partial<ActivitySegment> = {},
): ActivitySegment {
  return {
    id,
    appName: "cmux",
    bundleId: "com.example.cmux",
    durationSeconds,
    endedAt,
    platform: "macos",
    source: "accessibility",
    startedAt,
    windowTitle: "drifty_mac",
    ...options,
  };
}

describe("buildHistoryRows", () => {
  it("keeps new known-app activity unclassified while built-in heuristics are gated", () => {
    const rows = buildHistoryRows([
      historySegment("new", "2026-06-10T01:00:00+00:00", "2026-06-10T01:10:00+00:00", 600),
    ], {
      includeBuiltInHeuristics: false,
      builtInHeuristicsUnavailableSince: "2026-06-10T00:00:00+00:00",
    });

    expect(rows[0]?.classification).toMatchObject({ category: "unknown", productivity: "neutral" });
  });

  it("merges adjacent records when app and window title stay the same", () => {
    const rows = buildHistoryRows([
      historySegment("middle", "2026-06-10T01:10:00+00:00", "2026-06-10T01:20:00+00:00", 600),
      historySegment("end", "2026-06-10T01:20:00+00:00", "2026-06-10T01:30:00+00:00", 600),
      historySegment("start", "2026-06-10T01:00:00+00:00", "2026-06-10T01:10:00+00:00", 600),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "history-row-start-end",
      startedAt: "2026-06-10T01:00:00+00:00",
      endedAt: "2026-06-10T01:30:00+00:00",
      durationSeconds: 1_800,
      segmentIds: ["start", "middle", "end"],
    });
  });

  it("keeps app or window changes as separate rows", () => {
    const rows = buildHistoryRows([
      historySegment("cmux-1", "2026-06-10T01:00:00+00:00", "2026-06-10T01:10:00+00:00", 600),
      historySegment("notes", "2026-06-10T01:10:00+00:00", "2026-06-10T01:20:00+00:00", 600, {
        appName: "Notes",
        bundleId: "com.apple.Notes",
        windowTitle: "Planning",
      }),
      historySegment("cmux-2", "2026-06-10T01:20:00+00:00", "2026-06-10T01:30:00+00:00", 600),
      historySegment("cmux-other-window", "2026-06-10T01:30:00+00:00", "2026-06-10T01:40:00+00:00", 600, {
        windowTitle: "other_repo",
      }),
    ]);

    expect(rows.map((row) => row.segmentIds)).toEqual([
      ["cmux-other-window"],
      ["cmux-2"],
      ["notes"],
      ["cmux-1"],
    ]);
  });
});

describe("buildHistoryRowsWindow", () => {
  it("returns only the newest requested rows while keeping a merged boundary row complete", () => {
    const windowedRows = buildHistoryRowsWindow([
      historySegment("older", "2026-06-10T01:00:00+00:00", "2026-06-10T01:30:00+00:00", 1_800, {
        appName: "Notes",
        bundleId: "com.apple.Notes",
        windowTitle: "Planning",
      }),
      historySegment("latest-start", "2026-06-10T02:00:00+00:00", "2026-06-10T02:10:00+00:00", 600),
      historySegment("latest-end", "2026-06-10T02:10:00+00:00", "2026-06-10T02:30:00+00:00", 1_200),
    ], 1);

    expect(windowedRows.hasMore).toBe(true);
    expect(windowedRows.rows).toHaveLength(1);
    expect(windowedRows.rows[0]).toMatchObject({
      id: "history-row-latest-start-latest-end",
      startedAt: "2026-06-10T02:00:00+00:00",
      endedAt: "2026-06-10T02:30:00+00:00",
      durationSeconds: 1_800,
      segmentIds: ["latest-start", "latest-end"],
    });
  });

  it("reports no older rows when the requested window covers the timeline", () => {
    const windowedRows = buildHistoryRowsWindow([
      historySegment("start", "2026-06-10T01:00:00+00:00", "2026-06-10T01:10:00+00:00", 600),
      historySegment("end", "2026-06-10T01:10:00+00:00", "2026-06-10T01:20:00+00:00", 600),
    ], 5);

    expect(windowedRows.hasMore).toBe(false);
    expect(windowedRows.rows.map((row) => row.segmentIds)).toEqual([["start", "end"]]);
  });

  it("formats excluded segments with truth-accurate label in history row title", () => {
    const rows = buildHistoryRows([
      historySegment("ex-default", "2026-06-10T01:00:00+00:00", "2026-06-10T01:10:00+00:00", 600, {
        appName: "[Redacted]",
        exclusionSource: "default",
      }),
      historySegment("ex-user", "2026-06-10T02:00:00+00:00", "2026-06-10T02:10:00+00:00", 600, {
        appName: "[Redacted]",
        exclusionSource: "user",
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.exclusionSource).sort()).toEqual(["default", "user"]);
    expect(rows.every((row) => historyRowTitle(row) === "")).toBe(true);
  });
});

describe("buildHistoryDayGroups", () => {
  it("groups records by local logical day instead of the UTC date key", () => {
    const startedAt = new Date(2026, 5, 22, 5, 30, 0, 0).toISOString();
    const endedAt = new Date(2026, 5, 22, 5, 45, 0, 0).toISOString();
    const rows = buildHistoryRows([
      historySegment("local-morning", startedAt, endedAt, 900),
    ]);

    const groups = buildHistoryDayGroups(rows, 4 * 60);
    const firstGroup = groups[0];
    if (!firstGroup) throw new Error("Expected a history day group");

    expect(firstGroup.dayKey).toBe(logicalDayIsoDateForDate(new Date(startedAt), 4 * 60));
    expect(firstGroup.dayKey).not.toBe(startedAt.slice(0, 10));
    expect(firstGroup.rows.map((row) => row.segmentIds)).toEqual([["local-morning"]]);
  });
});
