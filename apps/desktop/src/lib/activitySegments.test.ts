import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { latestActivitySegmentCursor } from "./activitySegments";

const segment = (id: string, endedAt: string): ActivitySegment => ({
  id, startedAt: endedAt, endedAt, durationSeconds: 5,
  appName: "Synthetic QA", platform: "windows", source: "accessibility",
});

describe("latestActivitySegmentCursor", () => {
  it("advances the insertion cursor independently of wall time after a clock correction", () => {
    expect(latestActivitySegmentCursor([
      segment("1", "2026-10-03T12:00:00Z"),
      segment("9", "2026-10-03T11:30:40Z"),
      segment("2", "2026-10-03T11:30:05Z"),
    ])).toEqual({ afterSegmentId: "9", afterEndedAt: "2026-10-03T12:00:00Z" });
  });

  it("keeps chronological extension detection while an older interval gets a new id", () => {
    expect(latestActivitySegmentCursor([
      segment("2", "2026-10-03T12:10:00Z"),
      segment("100", "2026-10-03T08:00:00Z"),
    ])).toEqual({ afterSegmentId: "100", afterEndedAt: "2026-10-03T12:10:00Z" });
  });

  it("preserves empty, same-time, and preview cursors", () => {
    expect(latestActivitySegmentCursor([])).toEqual({ afterSegmentId: null, afterEndedAt: null });
    expect(latestActivitySegmentCursor([
      segment("2", "2026-10-03T12:00:00Z"),
      segment("3", "2026-10-03T12:00:00Z"),
    ])).toEqual({ afterSegmentId: "3", afterEndedAt: "2026-10-03T12:00:00Z" });
    expect(latestActivitySegmentCursor([
      segment("preview-one", "2026-10-03T12:00:00Z"),
      segment("preview-two", "2026-10-03T13:00:00Z"),
    ])).toEqual({ afterSegmentId: "preview-two", afterEndedAt: "2026-10-03T13:00:00Z" });
  });
});
