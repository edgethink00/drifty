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
  it("normalizes corroborated window decorations without changing recorded time or source ids", () => {
    const inputs = ["900 MB", "1.2 GB"].map((memory, i) => seg({
      id: `record-${i}`, appName: "Google Chrome", siteDomain: "example.com", siteTitle: "Document",
      windowTitle: `Document - High memory usage - ${memory} - Chrome - Work`,
      startedAt: `2026-04-06T09:0${i}:00+00:00`, endedAt: `2026-04-06T09:0${i + 1}:00+00:00`, durationSeconds: 60,
    }));
    const [window] = buildProjectPassAnalysisWindows(inputs, {
      contextPolicy: { windowTitle: true, contentContext: true, siteUrl: false },
    });
    expect(window.durationSeconds).toBe(120);
    expect(window.segmentIds).toEqual(["record-0", "record-1"]);
    expect(window.contributors[0].contexts).toEqual([expect.objectContaining({
      windowTitle: "Document - Work", title: "Document", durationSeconds: 120,
    })]);
    const [withoutContent] = buildProjectPassAnalysisWindows(inputs, {
      contextPolicy: { windowTitle: true, contentContext: false, siteUrl: false },
    });
    expect(withoutContent.contributors[0].contexts[0].windowTitle).toContain("High memory usage");
    expect(inputs[0].windowTitle).toContain("900 MB");
  });

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

  it("holds the latest fixed cell until its full 3-minute interval has ended", () => {
    const segments = [
      seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:04:00+00:00", durationSeconds: 240, appName: "Code" }),
    ];

    const duringLatestCell = buildProjectPassAnalysisWindows(segments, {
      completedThrough: "2026-04-06T09:04:30+00:00",
    });
    expect(duringLatestCell).toHaveLength(1);
    expect(duringLatestCell[0].startedAt).toBe("2026-04-06T09:00:00.000Z");

    const afterLatestCell = buildProjectPassAnalysisWindows(segments, {
      completedThrough: "2026-04-06T09:06:00+00:00",
    });
    expect(afterLatestCell).toHaveLength(2);
    expect(afterLatestCell[1].startedAt).toBe("2026-04-06T09:03:00.000Z");
  });

  it("fails closed when a requested completion boundary is invalid", () => {
    const windows = buildProjectPassAnalysisWindows(
      [seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:03:00+00:00", durationSeconds: 180, appName: "Code" })],
      { completedThrough: "not-a-timestamp" },
    );

    expect(windows).toEqual([]);
  });

  it("includes a fixed cell exactly when its end reaches the completion boundary", () => {
    const windows = buildProjectPassAnalysisWindows(
      [seg({ id: "1", startedAt: "2026-04-06T09:00:00+00:00", endedAt: "2026-04-06T09:03:00+00:00", durationSeconds: 180, appName: "Code" })],
      { completedThrough: "2026-04-06T09:03:00+00:00" },
    );

    expect(windows).toHaveLength(1);
    expect(windows[0].endedAt).toBe("2026-04-06T09:03:00.000Z");
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
