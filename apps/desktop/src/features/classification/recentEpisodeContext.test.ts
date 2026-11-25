import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";

import { DEFAULT_AI_PRIVACY_REQUEST_SETTINGS } from "../settings/aiPrivacyRequestSettings";
import { buildRecentEpisodeContext, episodeContextDigestMaterial } from "./recentEpisodeContext";

function segment(input: Partial<ActivitySegment> & Pick<ActivitySegment, "id" | "startedAt" | "endedAt" | "appName">): ActivitySegment {
  return {
    durationSeconds: Math.max(0, (Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1_000),
    platform: "macos",
    source: "nsworkspace",
    ...input,
  };
}

describe("recent Episode context", () => {
  it("keeps native FPS churn out of the recent-context fingerprint", () => {
    const make = (fps: string) => segment({
      id: "game", appName: "mgba", startedAt: "2026-08-14T09:59:00Z", endedAt: "2026-08-14T10:00:00Z",
      windowTitle: `mGBA - HOMEBREW DEMO (${fps} fps) - 0.10.5`,
    });
    const context = (fps: string) => buildRecentEpisodeContext({
      current: make(fps), segments: [], privacySettings: DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
    });
    expect(episodeContextDigestMaterial(context("120.3"))).toBe(episodeContextDigestMaterial(context("121.0")));
    expect(context("120.3").transitions[0].title).toBe("mGBA - HOMEBREW DEMO - 0.10.5");
  });

  it("compresses the continuous last 30 minutes into a bounded transition sequence", () => {
    const segments = [
      segment({ id: "code", startedAt: "2026-08-14T09:40:00.000Z", endedAt: "2026-08-14T09:50:00.000Z", appName: "Cursor", windowTitle: "Drifty classifier" }),
      segment({ id: "search", startedAt: "2026-08-14T09:50:10.000Z", endedAt: "2026-08-14T09:55:00.000Z", appName: "Google Chrome", siteDomain: "google.com", siteTitle: "Instagram AI product marketing research" }),
      segment({ id: "reel-a", startedAt: "2026-08-14T09:55:05.000Z", endedAt: "2026-08-14T09:58:00.000Z", appName: "Google Chrome", siteDomain: "instagram.com", siteTitle: "AI product launch reel" }),
      segment({ id: "reel-b", startedAt: "2026-08-14T09:58:00.000Z", endedAt: "2026-08-14T10:00:00.000Z", appName: "Google Chrome", siteDomain: "instagram.com", siteTitle: "AI product launch reel" }),
    ];

    const episode = buildRecentEpisodeContext({
      current: segments[3],
      segments,
      privacySettings: DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
    });

    expect(episode.windowMinutes).toBe(30);
    expect(episode.transitions).toHaveLength(3);
    expect(episode.transitions[2]).toMatchObject({ domain: "instagram.com", durationSeconds: 295 });
    expect(episode.currentSurfaceSeconds).toBe(295);
    expect(episodeContextDigestMaterial(episode)).not.toContain("2026-08-14");
  });

  it("ends the Episode with a current point sample and credits its recorded time", () => {
    const prior = segment({
      id: "prior",
      appName: "Messages",
      startedAt: "2026-08-14T09:59:36Z",
      endedAt: "2026-08-14T10:00:03Z",
    });
    const current = segment({
      id: "current",
      appName: "Safari",
      siteDomain: "video.example",
      siteTitle: "Match highlights",
      startedAt: "2026-08-14T10:00:00Z",
      endedAt: "2026-08-14T10:00:00Z",
      durationSeconds: 6,
    });
    const later = segment({
      id: "later",
      appName: "Calendar",
      startedAt: "2026-08-14T10:00:00Z",
      endedAt: "2026-08-14T10:00:06Z",
    });

    const episode = buildRecentEpisodeContext({
      current,
      segments: [prior, later, current],
      privacySettings: DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
    });

    expect(episode.transitions).toEqual([
      { appName: "Messages", durationSeconds: 24 },
      { appName: "Safari", domain: "video.example", title: "Match highlights", durationSeconds: 6 },
    ]);
    expect(episode.observedMinutes).toBe(1);
    expect(episode.dominantSurface).toBe("Messages");
    expect(episode.currentSurfaceSeconds).toBe(6);
  });

  it("keeps a point sample at the end across a gap without exposing disabled titles", () => {
    const prior = segment({
      id: "prior",
      appName: "Messages",
      startedAt: "2026-08-14T09:53:00Z",
      endedAt: "2026-08-14T09:54:00Z",
    });
    const current = segment({
      id: "current",
      appName: "Safari",
      siteDomain: "video.example",
      siteTitle: "Private page title",
      windowTitle: "Private window title",
      startedAt: "2026-08-14T10:00:00Z",
      endedAt: "2026-08-14T10:00:00Z",
      durationSeconds: 6,
    });

    const episode = buildRecentEpisodeContext({
      current,
      segments: [prior],
      privacySettings: {
        ...DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
        optional: { ...DEFAULT_AI_PRIVACY_REQUEST_SETTINGS.optional, contentContext: false, windowTitle: false },
      },
    });

    expect(episode.transitions).toEqual([{ appName: "Safari", domain: "video.example", durationSeconds: 6 }]);
    expect(episode.dominantSurface).toBe("video.example");
    expect(episode.currentSurfaceSeconds).toBe(6);
  });

  it("fits a current point sample inside the 30-minute window without counting a duplicate", () => {
    const prior = segment({
      id: "prior",
      appName: "TextEdit",
      startedAt: "2026-08-14T09:20:00Z",
      endedAt: "2026-08-14T10:00:00Z",
    });
    const current = segment({
      id: "current",
      appName: "Safari",
      startedAt: "2026-08-14T10:00:00Z",
      endedAt: "2026-08-14T10:00:00Z",
      durationSeconds: 6,
    });
    const duplicate = { ...current, startedAt: "2026-08-14T09:59:54Z" };

    const episode = buildRecentEpisodeContext({
      current,
      segments: [prior, duplicate],
      privacySettings: DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
    });

    expect(episode.transitions).toEqual([
      { appName: "TextEdit", durationSeconds: 1_794 },
      { appName: "Safari", durationSeconds: 6 },
    ]);
    expect(episode.observedMinutes).toBe(30);
    expect(episode.currentSurfaceSeconds).toBe(6);
  });

  it("treats excluded apps and sites as unobserved time", () => {
    const code = segment({ id: "code", startedAt: "2026-08-14T09:50:00.000Z", endedAt: "2026-08-14T09:55:00.000Z", appName: "Cursor" });
    const excluded = segment({ id: "excluded", startedAt: "2026-08-14T09:55:00.000Z", endedAt: "2026-08-14T09:58:00.000Z", appName: "[Redacted]", exclusionSource: "user" });
    const current = segment({ id: "current", startedAt: "2026-08-14T09:58:00.000Z", endedAt: "2026-08-14T10:00:00.000Z", appName: "TextEdit" });

    const episode = buildRecentEpisodeContext({ current, segments: [code, excluded, current], privacySettings: DEFAULT_AI_PRIVACY_REQUEST_SETTINGS });

    expect(episode.transitions).toEqual([
      { appName: "Cursor", durationSeconds: 300 },
      { appName: "TextEdit", durationSeconds: 120 },
    ]);
    expect(episode.observedMinutes).toBe(7);
    expect(JSON.stringify(episode)).not.toContain("Redacted");

    const longExcluded = segment({ id: "long", startedAt: "2026-08-14T09:45:00.000Z", endedAt: "2026-08-14T09:58:00.000Z", appName: "[Redacted]", exclusionSource: "default" });
    const earlier = segment({ id: "earlier", startedAt: "2026-08-14T09:40:00.000Z", endedAt: "2026-08-14T09:45:00.000Z", appName: "Cursor" });
    const cut = buildRecentEpisodeContext({ current, segments: [earlier, longExcluded, current], privacySettings: DEFAULT_AI_PRIVACY_REQUEST_SETTINGS });
    expect(cut.transitions).toEqual([{ appName: "TextEdit", durationSeconds: 120 }]);
    expect(cut.dominantSurface).not.toContain("Redacted");
  });

  it("cuts context at a long gap and excludes another device", () => {
    const old = segment({ id: "old", startedAt: "2026-08-14T09:30:00.000Z", endedAt: "2026-08-14T09:35:00.000Z", appName: "Cursor" });
    const remote = segment({ id: "remote", startedAt: "2026-08-14T09:58:00.000Z", endedAt: "2026-08-14T09:59:00.000Z", appName: "Slack", deviceId: "other-mac" });
    const current = segment({ id: "current", startedAt: "2026-08-14T09:59:00.000Z", endedAt: "2026-08-14T10:00:00.000Z", appName: "Safari", siteDomain: "instagram.com" });

    const episode = buildRecentEpisodeContext({
      current,
      segments: [old, remote, current],
      privacySettings: DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
    });

    expect(episode.transitions).toEqual([{ appName: "Safari", domain: "instagram.com", durationSeconds: 60 }]);
  });

  it("honors title privacy settings in every historical transition", () => {
    const current = segment({
      id: "current",
      startedAt: "2026-08-14T09:59:00.000Z",
      endedAt: "2026-08-14T10:00:00.000Z",
      appName: "Safari",
      siteDomain: "instagram.com",
      siteTitle: "private launch title",
      windowTitle: "private window title",
    });
    const episode = buildRecentEpisodeContext({
      current,
      segments: [current],
      privacySettings: {
        ...DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
        optional: { ...DEFAULT_AI_PRIVACY_REQUEST_SETTINGS.optional, contentContext: false, windowTitle: false },
      },
    });

    expect(JSON.stringify(episode)).not.toContain("private");
  });

  it("uses consented window titles for native communication context when no content title exists", () => {
    const message = segment({
      id: "message",
      startedAt: "2026-08-14T09:58:00.000Z",
      endedAt: "2026-08-14T09:59:00.000Z",
      appName: "Messages",
      windowTitle: "Jordan",
    });
    const current = segment({
      id: "current",
      startedAt: "2026-08-14T09:59:00.000Z",
      endedAt: "2026-08-14T10:00:00.000Z",
      appName: "Safari",
      siteDomain: "instagram.com",
      siteTitle: "Campaign reel",
    });

    const episode = buildRecentEpisodeContext({
      current,
      segments: [message, current],
      privacySettings: DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
    });

    expect(episode.transitions[0]).toMatchObject({ appName: "Messages", title: "Jordan" });
  });

  it("clips observed durations to the exact past window and current endpoint", () => {
    const spanning = segment({
      id: "spanning",
      startedAt: "2026-08-14T09:00:00.000Z",
      endedAt: "2026-08-14T09:45:00.000Z",
      appName: "Cursor",
    });
    const current = segment({
      id: "current",
      startedAt: "2026-08-14T09:45:00.000Z",
      endedAt: "2026-08-14T10:00:00.000Z",
      appName: "Safari",
      siteDomain: "instagram.com",
    });

    const episode = buildRecentEpisodeContext({
      current,
      segments: [spanning, current],
      privacySettings: DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
    });

    expect(episode.observedMinutes).toBe(30);
    expect(episode.transitions).toEqual([
      { appName: "Cursor", durationSeconds: 900 },
      { appName: "Safari", domain: "instagram.com", durationSeconds: 900 },
    ]);
  });
});
