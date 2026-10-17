import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { buildHistoryRows, buildHistoryRowsWindow } from "./historyGroups";
import { historyPageDestination, historyWebUrl } from "./historyPageUrl";

const first: ActivitySegment = {
  id: "first", appName: "Chrome", browserName: "Chrome", bundleId: "com.google.Chrome",
  startedAt: "2026-10-17T09:00:00Z", endedAt: "2026-10-17T09:01:00Z", durationSeconds: 60,
  siteDomain: "docs.example.com", siteTitle: "Documentation", siteUrl: "https://docs.example.com/guide?q=one#example",
  platform: "macos", source: "accessibility",
};

describe("History page destinations", () => {
  it("accepts web URLs while preserving destination query and fragment", () => {
    expect(historyWebUrl(first.siteUrl)).toBe(first.siteUrl);
    expect(historyWebUrl("http://example.com")).toBe("http://example.com/");
    for (const value of [null, undefined, "", "example.com/page", "javascript:alert(1)", "file:///tmp/page", "data:text/html,test", "chrome://settings", "https://user:password@example.com/", "https://"]) {
      expect(historyWebUrl(value)).toBeNull();
    }
  });

  it.each(["forward", "backward"])("refuses ambiguous merged rows in the %s view without altering display grouping", (direction) => {
    const second = { ...first, id: "second", startedAt: first.endedAt, endedAt: "2026-10-17T09:02:00Z", siteUrl: "https://docs.example.com/other" };
    const segments = [first, second];
    const rows = direction === "forward" ? buildHistoryRows(segments) : buildHistoryRowsWindow(segments, 10).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.segmentIds).toEqual(["first", "second"]);
    expect(historyPageDestination(rows[0]!, new Map(segments.map(segment => [segment.id, segment])))).toBeNull();
    expect(rows[0]!.siteUrl).toBe(first.siteUrl);
  });

  it("opens a merged row only when every original segment has the same address", () => {
    const second = { ...first, id: "second", startedAt: first.endedAt, endedAt: "2026-10-17T09:02:00Z" };
    const row = buildHistoryRows([first, second])[0]!;
    expect(historyPageDestination(row, new Map([[first.id, first], [second.id, second]]))).toBe(first.siteUrl);
    expect(historyPageDestination(row, new Map([[first.id, first]]))).toBeNull();
    expect(historyPageDestination(row, new Map([[first.id, first], [second.id, { ...second, siteUrl: null }]]))).toBeNull();
  });

  it("does not open excluded, non-site, or empty rows", () => {
    const row = buildHistoryRows([first])[0]!;
    const originals = new Map([[first.id, first]]);
    expect(historyPageDestination({ ...row, exclusionSource: "user" }, originals)).toBeNull();
    expect(historyPageDestination({ ...row, siteDomain: null }, originals)).toBeNull();
    expect(historyPageDestination({ ...row, segmentIds: [] }, originals)).toBeNull();
  });
});
