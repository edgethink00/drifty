import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { buildContinuousDriftAlarmEpisode } from "./driftAlarmEpisode";

describe("buildContinuousDriftAlarmEpisode", () => {
  it("accumulates consecutive Reel URLs on the same browser surface", () => {
    const first = reel("reel-a", "2026-08-30T09:00:00.000Z", "2026-08-30T09:00:25.000Z", 25);
    const second = reel("reel-b", "2026-08-30T09:00:30.000Z", "2026-08-30T09:00:55.000Z", 25);
    const current = reel("reel-c", "2026-08-30T09:01:00.000Z", "2026-08-30T09:01:10.000Z", 10);

    const episode = buildContinuousDriftAlarmEpisode({
      currentSegment: current,
      segments: [current, first, second],
      isEligibleDrift: isDrift,
    });

    expect(episode).toEqual({
      episodeKey: "drift-episode:reel-a",
      surfaceKey: "browser:com.google.chrome:instagram.com",
      startedAt: first.startedAt,
      durationSeconds: 60,
      segmentIds: ["reel-a", "reel-b", "reel-c"],
    });
  });

  it("stops at an observed focus segment even when the surface returns", () => {
    const first = reel("reel-a", "2026-08-30T09:00:00.000Z", "2026-08-30T09:00:25.000Z", 25);
    const focus = reel("campaign-research", "2026-08-30T09:00:30.000Z", "2026-08-30T09:00:40.000Z", 10, "focus");
    const current = reel("reel-b", "2026-08-30T09:00:45.000Z", "2026-08-30T09:01:10.000Z", 25);

    const episode = buildContinuousDriftAlarmEpisode({
      currentSegment: current,
      segments: [first, focus, current],
      isEligibleDrift: isDrift,
    });

    expect(episode).toMatchObject({
      episodeKey: "drift-episode:reel-b",
      durationSeconds: 25,
      segmentIds: ["reel-b"],
    });
  });

  it("stops across another domain, browser, or a gap longer than fifteen seconds", () => {
    const current = reel("current", "2026-08-30T09:01:00.000Z", "2026-08-30T09:01:20.000Z", 20);
    const cases = [
      reel("youtube", "2026-08-30T09:00:35.000Z", "2026-08-30T09:00:55.000Z", 20, "drift", { siteDomain: "youtube.com" }),
      reel("safari", "2026-08-30T09:00:35.000Z", "2026-08-30T09:00:55.000Z", 20, "drift", { appName: "Safari", browserName: "Safari", bundleId: "com.apple.Safari" }),
      reel("old-reel", "2026-08-30T09:00:20.000Z", "2026-08-30T09:00:40.000Z", 20),
    ];

    for (const previous of cases) {
      expect(buildContinuousDriftAlarmEpisode({
        currentSegment: current,
        segments: [previous, current],
        isEligibleDrift: isDrift,
      })).toMatchObject({ durationSeconds: 20, segmentIds: ["current"] });
    }
  });

  it("excludes remote-device and browser-history rows from the local live episode", () => {
    const imported = reel("imported", "2026-08-30T09:00:00.000Z", "2026-08-30T09:00:20.000Z", 20, "drift", {
      source: "browser-history-import",
      siteSource: "browser-history-import",
    });
    const remote = reel("remote", "2026-08-30T09:00:25.000Z", "2026-08-30T09:00:45.000Z", 20, "drift", {
      deviceId: "other-mac",
    });
    const current = reel("current", "2026-08-30T09:00:50.000Z", "2026-08-30T09:01:10.000Z", 20);

    expect(buildContinuousDriftAlarmEpisode({
      currentSegment: current,
      segments: [imported, remote, current],
      isEligibleDrift: isDrift,
    })).toMatchObject({
      episodeKey: "drift-episode:current",
      durationSeconds: 20,
      segmentIds: ["current"],
    });
  });

  it("accumulates consecutive drift windows in the same native app", () => {
    const first = nativeApp("native-a", "2026-08-30T09:00:00.000Z", "2026-08-30T09:00:20.000Z", 20);
    const current = nativeApp("native-b", "2026-08-30T09:00:25.000Z", "2026-08-30T09:00:40.000Z", 15);

    expect(buildContinuousDriftAlarmEpisode({
      currentSegment: current,
      segments: [first, current],
      isEligibleDrift: isDrift,
    })).toEqual({
      episodeKey: "drift-episode:native-a",
      surfaceKey: "app:com.example.native-drift",
      startedAt: first.startedAt,
      durationSeconds: 35,
      segmentIds: ["native-a", "native-b"],
    });
  });

  it("never widens a browser episode when the current site context is missing", () => {
    const first = reel("unknown-a", "2026-08-30T09:00:00.000Z", "2026-08-30T09:00:20.000Z", 20, "drift", {
      siteDomain: null,
      siteTitle: null,
      siteUrl: null,
    });
    const current = reel("unknown-b", "2026-08-30T09:00:25.000Z", "2026-08-30T09:00:40.000Z", 15, "drift", {
      siteDomain: null,
      siteTitle: null,
      siteUrl: null,
    });

    expect(buildContinuousDriftAlarmEpisode({
      currentSegment: current,
      segments: [first, current],
      isEligibleDrift: isDrift,
    })).toMatchObject({
      episodeKey: "drift-episode:unknown-b",
      surfaceKey: "exact:unknown-b",
      durationSeconds: 15,
      segmentIds: ["unknown-b"],
    });
  });
});

function reel(
  id: string,
  startedAt: string,
  endedAt: string,
  durationSeconds: number,
  productivity: "drift" | "focus" = "drift",
  overrides: Partial<ActivitySegment> = {},
): ActivitySegment {
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds,
    appName: "Google Chrome",
    bundleId: "com.google.Chrome",
    browserName: "Google Chrome",
    windowTitle: `Instagram ${id}`,
    siteDomain: "www.instagram.com",
    siteTitle: `Instagram ${id}`,
    siteUrl: `https://www.instagram.com/reel/${id}/`,
    platform: "macos",
    source: "accessibility",
    classification: {
      category: productivity === "drift" ? "social_media" : "workspace",
      productivity,
      confidence: 0.95,
      source: "llm",
    },
    ...overrides,
  };
}

function isDrift(segment: ActivitySegment): boolean {
  return segment.classification?.productivity === "drift";
}

function nativeApp(
  id: string,
  startedAt: string,
  endedAt: string,
  durationSeconds: number,
): ActivitySegment {
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds,
    appName: "Native Drift",
    bundleId: "com.example.native-drift",
    windowTitle: id,
    browserName: null,
    siteDomain: null,
    siteTitle: null,
    siteUrl: null,
    platform: "macos",
    source: "accessibility",
    classification: {
      category: "entertainment",
      productivity: "drift",
      confidence: 0.95,
      source: "llm",
    },
  };
}
