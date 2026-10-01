import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { buildRecentFocusTargets } from "./driftAlarmData";

function focusSegment(appName: string, endedAt: string, durationSeconds = 60): ActivitySegment {
  return {
    id: `${appName}:${endedAt}`,
    startedAt: endedAt,
    endedAt,
    durationSeconds,
    appName,
    bundleId: `fixture.${appName}`,
    windowTitle: `Window ${appName}`,
    platform: "macos",
    source: "manual",
    classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 },
  };
}

const targetIds = (segments: ActivitySegment[], history: ActivitySegment[] = []) =>
  buildRecentFocusTargets(segments, history, {}, {}).map((target) => target.targetId);

afterEach(() => vi.restoreAllMocks());

describe("recent focus targets", () => {
  it("orders recent activity by the instant across timezone offsets without mutating input", () => {
    const segments = [
      focusSegment("Earlier", "2026-10-01T12:00:00+09:00"),
      focusSegment("Later", "2026-10-01T03:30:00Z"),
      focusSegment("Oldest", "2026-09-30T23:00:00Z"),
    ];
    const before = structuredClone(segments);

    expect(targetIds(segments)).toEqual(["app:fixture.Later", "app:fixture.Earlier"]);
    expect(segments).toEqual(before);
  });

  it("preserves input order when different offsets describe the same instant", () => {
    const segments = [
      focusSegment("First", "2026-10-01T12:30:00+09:00"),
      focusSegment("Second", "2026-10-01T03:30:00.000Z"),
    ];

    expect(targetIds(segments)).toEqual(["app:fixture.First", "app:fixture.Second"]);
  });

  it("keeps the inclusive weekly cutoff, duration ranking and deduplication", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-01T05:00:00Z"));
    const segments = [
      focusSegment("Recent", "2026-10-01T04:00:00Z"),
      focusSegment("Other", "2026-10-01T03:00:00Z"),
    ];
    const history = [
      focusSegment("Recent", "2026-09-30T00:00:00Z", 1000),
      focusSegment("Weekly1", "2026-09-24T14:00:00+09:00", 200),
      focusSegment("Weekly1", "2026-09-30T00:00:00Z", 200),
      focusSegment("Weekly2", "2026-09-29T00:00:00Z", 300),
      focusSegment("TooOld", "2026-09-24T04:59:59.999Z", 10000),
    ];
    const before = structuredClone(history);

    expect(targetIds(segments, history)).toEqual([
      "app:fixture.Recent", "app:fixture.Weekly1", "app:fixture.Weekly2", "app:fixture.Other",
    ]);
    expect(history).toEqual(before);
  });
});
