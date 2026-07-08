import { describe, expect, it } from "vitest";
import {
  buildProjectPassAnalysisWindows,
  formatProjectPassAnalysisWindowLine,
  type ActivitySegment,
} from "@drifty/domain";

function seg(
  fields: Pick<ActivitySegment, "id" | "startedAt" | "endedAt" | "durationSeconds" | "appName"> &
    Partial<ActivitySegment>,
): ActivitySegment {
  return { platform: "macos", source: "accessibility", ...fields };
}

function localIso(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

describe("buildProjectPassAnalysisWindows", () => {
  it("builds 3-minute based windows and merges adjacent cells with the same dominant surface", () => {
    const windows = buildProjectPassAnalysisWindows([
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:02:00+00:00", durationSeconds: 120, appName: "Code" }),
      seg({ id: "2", startedAt: "2026-04-06T09:02:00+00:00", endedAt: "2026-04-06T09:07:00+00:00", durationSeconds: 300, appName: "Code" }),
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      id: "w0",
      durationSeconds: 420,
      bucketCount: 3,
      appName: "Code",
      domain: null,
    });
    expect(windows[0].segmentIds).toEqual(["1", "2"]);
  });

  it("summarizes top contributors and keeps correction ids on the dominant contributor for mixed cells", () => {
    const windows = buildProjectPassAnalysisWindows([
      seg({ id: "code", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:02:00+00:00", durationSeconds: 120, appName: "Code", classification: { category: "workspace", productivity: "focus", source: "llm", confidence: 0.9 } }),
      seg({ id: "slack", startedAt: "2026-04-06T09:02:00+00:00", endedAt: "2026-04-06T09:03:00+00:00", durationSeconds: 60, appName: "Slack", classification: { category: "communication", productivity: "neutral", source: "llm", confidence: 0.8 } }),
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0].contributors.map((contributor) => contributor.appName)).toEqual(["Code", "Slack"]);
    expect(windows[0].correctionSegmentIds).toEqual(["code"]);
    expect(formatProjectPassAnalysisWindowLine(windows[0])).toContain("also: Slack");
  });

  it("does not merge across the configured logical day boundary", () => {
    const windows = buildProjectPassAnalysisWindows(
      [
        seg({ id: "1", startedAt: localIso(2026, 4, 6, 2, 58), endedAt: localIso(2026, 4, 6, 3, 4), durationSeconds: 360, appName: "Code" }),
      ],
      { startOfDayMinutes: 180 },
    );

    expect(windows).toHaveLength(2);
    expect(windows.map((window) => window.bucketCount)).toEqual([1, 2]);
  });

  it("omits raw title context by default", () => {
    const windows = buildProjectPassAnalysisWindows([
      seg({
        id: "1",
        startedAt: "2026-04-06T09:00:00+00:00",
        endedAt: "2026-04-06T09:03:00+00:00",
        durationSeconds: 180,
        appName: "Chrome",
        siteDomain: "example.com",
        siteTitle: "Sensitive raw page title",
      }),
    ]);

    const line = formatProjectPassAnalysisWindowLine(windows[0]);
    expect(line).toContain("Chrome · example.com");
    expect(line).not.toContain("Sensitive raw page title");
  });
});
