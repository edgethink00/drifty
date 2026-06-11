import { describe, expect, it } from "vitest";
import { classifyActivityDetailed, type ActivitySegment } from "@drifty/domain";

function youtubeSegment(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    id: "youtube-music-segment",
    startedAt: "2026-06-12T00:00:00+09:00",
    endedAt: "2026-06-12T01:00:55+09:00",
    durationSeconds: 3655,
    appName: "Google Chrome",
    browserName: "Google Chrome",
    siteDomain: "youtube.com",
    siteTitle: "[Playlist🎧] 여름밤 산책 노래 모음 - YouTube",
    siteUrl: "https://www.youtube.com/watch?v=MusicQA0001",
    youtubeVideoId: "MusicQA0001",
    youtubeCategory: "Entertainment",
    youtubeChannelName: "Sample Music Channel",
    youtubeTitle: "[Playlist🎧] 여름밤 산책 노래 모음",
    youtubeDescription: "#플레이리스트\n00:00 Artist A - Song One\n03:08 Artist B - Song Two",
    youtubeKeywords: ["여름플리", "플레이리스트", "playlist", "노래", "모음", "발라드플레이리스트"],
    youtubeDurationSeconds: 3655,
    platform: "macos",
    source: "accessibility",
    ...overrides,
  };
}

describe("YouTube classification", () => {
  it("classifies entertainment-category music playlist metadata as music", () => {
    const classification = classifyActivityDetailed(youtubeSegment());

    expect(classification).toEqual(expect.objectContaining({
      category: "music",
      productivity: "neutral",
      source: "youtube",
    }));
  });

  it("keeps radio playlist URLs as music even when official metadata says entertainment", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      siteUrl: "https://www.youtube.com/watch?v=MusicQA0001&list=RDMusicQA0001&start_radio=1",
      youtubePlaylistId: "RDMusicQA0001",
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "music",
      productivity: "neutral",
      source: "youtube",
    }));
  });
});
