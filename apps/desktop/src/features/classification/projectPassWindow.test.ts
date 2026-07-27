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
  it("keeps every 3-minute cell independent even when the dominant surface stays the same", () => {
    const windows = buildProjectPassAnalysisWindows([
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:02:00+00:00", durationSeconds: 120, appName: "Code" }),
      seg({ id: "2", startedAt: "2026-04-06T09:02:00+00:00", endedAt: "2026-04-06T09:07:00+00:00", durationSeconds: 300, appName: "Code" }),
    ]);

    expect(windows).toHaveLength(3);
    expect(windows.map((window) => window.durationSeconds)).toEqual([180, 180, 60]);
    expect(windows.map((window) => window.bucketCount)).toEqual([1, 1, 1]);
    expect(windows.map((window) => window.appName)).toEqual(["Code", "Code", "Code"]);
    expect(windows[0].segmentIds).toEqual(["1", "2"]);
    expect(windows[1].segmentIds).toEqual(["2"]);
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

  it("keeps fixed buckets on both sides of a configured logical day boundary", () => {
    const windows = buildProjectPassAnalysisWindows(
      [
        seg({ id: "1", startedAt: localIso(2026, 4, 6, 2, 58), endedAt: localIso(2026, 4, 6, 3, 4), durationSeconds: 360, appName: "Code" }),
      ],
      { startOfDayMinutes: 180 },
    );

    expect(windows).toHaveLength(3);
    expect(windows.map((window) => window.bucketCount)).toEqual([1, 1, 1]);
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

  it("includes only privacy-enabled URL, window-title, and content context fields", () => {
    const input = seg({
      id: "1",
      startedAt: "2026-04-06T09:00:00+00:00",
      endedAt: "2026-04-06T09:03:00+00:00",
      durationSeconds: 180,
      appName: "Chrome",
      siteDomain: "example.com",
      siteUrl: "https://user:secret@example.com/docs?token=secret#fragment",
      windowTitle: "Window title",
      siteTitle: "Page title",
      youtubeChannelName: "Channel",
      youtubeCategory: "Education",
    });
    const [window] = buildProjectPassAnalysisWindows([input], {
      contextPolicy: { siteUrl: true, windowTitle: false, contentContext: true },
    });
    const line = formatProjectPassAnalysisWindowLine(window);

    expect(line).toContain('url="https://example.com/docs"');
    expect(line).toContain('title="Page title"');
    expect(line).toContain('channel="Channel"');
    expect(line).toContain('videoCategory="Education"');
    expect(line).not.toContain("Window title");
    expect(line).not.toContain("secret");
  });

  it("does not derive Reddit community context from an enabled URL when content context is off", () => {
    const input = seg({
      id: "reddit",
      startedAt: "2026-04-06T09:00:00+00:00",
      endedAt: "2026-04-06T09:03:00+00:00",
      durationSeconds: 180,
      appName: "Chrome",
      siteDomain: "reddit.com",
      siteUrl: "https://reddit.com/r/private_project/comments/123?token=secret",
      siteTitle: "r/private_project discussion",
      windowTitle: "r/private_project",
    });

    const [urlOnlyWindow] = buildProjectPassAnalysisWindows([input], {
      contextPolicy: { siteUrl: true, windowTitle: false, contentContext: false },
    });
    const urlOnlyLine = formatProjectPassAnalysisWindowLine(urlOnlyWindow);
    expect(urlOnlyLine).toContain('url="https://reddit.com/r/private_project/comments/123"');
    expect(urlOnlyLine).not.toContain("reddit=");

    const [contentWindow] = buildProjectPassAnalysisWindows([input], {
      contextPolicy: { siteUrl: true, windowTitle: false, contentContext: true },
    });
    expect(formatProjectPassAnalysisWindowLine(contentWindow)).toContain('reddit="private_project"');
  });
});
