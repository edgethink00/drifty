import { describe, expect, it } from "vitest";
import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";
import { buildExtremeNudgeTarget } from "./extremeNudgeData";

const segment: ActivitySegment = {
  id: "shorts-a", startedAt: "2026-10-04T00:00:00Z", endedAt: "2026-10-04T00:01:00Z", durationSeconds: 60,
  appName: "Google Chrome", bundleId: "com.google.Chrome", browserName: "Google Chrome",
  siteDomain: "youtube.com", siteTitle: "Shorts", windowTitle: "Shorts - YouTube",
  siteUrl: "https://www.youtube.com/shorts/VideoABC123?feature=share", youtubeVideoId: "VideoABC123", youtubeIsShorts: true,
  source: "accessibility", platform: "macos",
};
const current: CurrentActivitySnapshot = { ...segment, observedAt: "2026-10-04T00:01:01Z" };

function target(snapshot: CurrentActivitySnapshot, stored = segment) {
  return buildExtremeNudgeTarget(stored, { confirmedCurrentSnapshot: snapshot });
}

describe("automatic close current YouTube address", () => {
  it.each(["macos", "windows"] as const)("uses the freshly verified same-video URL on %s", platform => {
    const bundleId = platform === "windows" ? "c:\\program files\\google\\chrome\\application\\chrome.exe" : segment.bundleId;
    const stored = { ...segment, bundleId, platform };
    const siteUrl = "https://www.youtube.com/shorts/VideoABC123";
    expect(target({ ...current, bundleId, siteUrl }, stored)).toMatchObject({ siteUrl });
    expect(stored.siteUrl).toBe(segment.siteUrl);
  });

  it("refreshes query/hash-only changes on the same watch URL", () => {
    const stored = { ...segment, siteUrl: "https://www.youtube.com/watch?v=VideoABC123&feature=share", youtubeIsShorts: false };
    const siteUrl = "https://www.youtube.com/watch?v=VideoABC123&t=10#player";
    expect(target({ ...current, siteUrl, youtubeIsShorts: false }, stored)?.siteUrl).toBe(siteUrl);
  });

  it.each([
    { siteUrl: "https://www.youtube.com/", youtubeVideoId: "VideoABC123" },
    { siteUrl: null, youtubeVideoId: "VideoABC123" },
    { siteUrl: "not a URL", youtubeVideoId: "VideoABC123" },
    { siteUrl: "https://www.youtube.com/shorts/OtherVideo", youtubeVideoId: "VideoABC123" },
    { siteUrl: "https://example.com/shorts/VideoABC123", youtubeVideoId: "VideoABC123" },
    { siteUrl: "https://www.youtube.com/shorts/VideoABC123", youtubeVideoId: null },
    { siteUrl: "https://www.youtube.com/shorts/VideoABC123", youtubeVideoId: "videoabc123" },
  ])("preserves the captured address when a replacement is unproven: %j", override => {
    expect(target({ ...current, ...override })?.siteUrl).toBe(segment.siteUrl);
  });

  it("does not refresh the native target for a different video", () => {
    expect(target({ ...current, siteUrl: "https://www.youtube.com/shorts/OtherVideo", youtubeVideoId: "OtherVideo" })).toMatchObject({ siteUrl: segment.siteUrl });
  });

  it("does not refresh when playlist evidence changes", () => {
    const stored = { ...segment, siteUrl: "https://www.youtube.com/watch?v=VideoABC123&list=RDVideoABC123", youtubeIsShorts: false };
    expect(target({ ...current, siteUrl: "https://www.youtube.com/watch?v=VideoABC123", youtubeIsShorts: false }, stored).siteUrl).toBe(stored.siteUrl);
  });

  it("does not refresh for another browser or app", () => {
    expect(target({ ...current, bundleId: "other.app", siteUrl: "https://www.youtube.com/shorts/VideoABC123" }).siteUrl).toBe(segment.siteUrl);
  });

  it("does not accept a changed watch video hidden by old metadata", () => {
    const stored = { ...segment, siteUrl: "https://www.youtube.com/watch?v=VideoABC123", youtubeIsShorts: false };
    expect(target({ ...current, siteUrl: "https://www.youtube.com/watch?v=OtherVideo", youtubeIsShorts: false }, stored)?.siteUrl).toBe(stored.siteUrl);
  });
});
