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

  it("does not classify an entertainment video as music from a recommendation playlist link alone", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      siteTitle: "지역 공감 월드컵 (with 게스트) - YouTube",
      siteUrl: "https://www.youtube.com/watch?v=EntQA000001",
      youtubeVideoId: "EntQA000001",
      youtubeChannelName: "Sample Entertainment Channel",
      youtubeTitle: "지역 공감 월드컵 (with 게스트)",
      youtubeDescription: [
        "▶같이 보면 좋은 추천 영상",
        "https://youtu.be/RecoQA00001",
        "▶'이상형 월드컵' 모아보기",
        "https://youtube.com/playlist?list=PLQAexamplePlaylist01",
      ].join("\n"),
      youtubeKeywords: null,
      youtubeDurationSeconds: 2396,
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "entertainment",
      productivity: "drift",
      source: "youtube",
    }));
  });

  it("does not classify playlist wording as music without a music-specific URL or music terms", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      siteTitle: "지역 맛집 플레이리스트 - YouTube",
      siteUrl: "https://www.youtube.com/watch?v=local-list",
      youtubeVideoId: "local-list",
      youtubeTitle: "지역 맛집 플레이리스트",
      youtubeDescription: "이번 주에 방문할 곳을 모아둔 플리입니다.",
      youtubeKeywords: ["playlist", "플레이리스트", "플리", "모음"],
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "entertainment",
      productivity: "drift",
      source: "youtube",
    }));
  });

  it("keeps short YouTube feed visits neutral", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      durationSeconds: 29,
      siteTitle: "YouTube",
      siteUrl: "https://www.youtube.com/feed",
      youtubeVideoId: null,
      youtubeCategory: null,
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "unknown",
      productivity: "neutral",
      source: "youtube",
    }));
  });

  it("classifies sustained YouTube feed visits as entertainment drift", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      durationSeconds: 30,
      siteTitle: "YouTube",
      siteUrl: "https://www.youtube.com/feed/subscriptions",
      youtubeVideoId: null,
      youtubeCategory: null,
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "entertainment",
      productivity: "drift",
      source: "youtube",
    }));
  });

  it("keeps YouTube home neutral even after thirty seconds", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      durationSeconds: 60,
      siteTitle: "YouTube",
      siteUrl: "https://www.youtube.com/",
      youtubeVideoId: null,
      youtubeCategory: null,
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "unknown",
      productivity: "neutral",
      source: "youtube",
    }));
  });
});
