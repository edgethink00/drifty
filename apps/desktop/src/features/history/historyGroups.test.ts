import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildHistoryRows } from "./historyGroups";

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
