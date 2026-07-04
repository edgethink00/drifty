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

  it("classifies a base-URL YouTube capture as a video when the window title names one", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      siteTitle: "YouTube",
      siteUrl: "https://www.youtube.com/",
      youtubeVideoId: null,
      youtubeCategory: null,
      windowTitle: "판타지 애니 몰아보기 [애니리뷰] - YouTube - 오디오 재생 - Aside",
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "entertainment",
      productivity: "drift",
      source: "youtube",
    }));
  });

  it("keeps a base-URL YouTube home page unknown when the title names no video", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      siteTitle: "YouTube",
      siteUrl: "https://www.youtube.com/",
      youtubeVideoId: null,
      youtubeCategory: null,
      windowTitle: "YouTube - Aside",
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "unknown",
      productivity: "neutral",
      source: "youtube",
    }));
  });

  it("keeps a YouTube search results page unknown even when the title reads like a video", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      siteTitle: "react useEffect tutorial - YouTube",
      siteUrl: "https://www.youtube.com/results?search_query=react+useEffect+tutorial",
      youtubeVideoId: null,
      youtubeCategory: null,
      windowTitle: "react useEffect tutorial - YouTube - Chrome",
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "unknown",
      productivity: "neutral",
      source: "youtube",
    }));
  });

  it("keeps a YouTube channel page unknown even when the title reads like a video", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      siteTitle: "Fireship - YouTube",
      siteUrl: "https://www.youtube.com/@Fireship",
      youtubeVideoId: null,
      youtubeCategory: null,
      windowTitle: "Fireship - YouTube - Chrome",
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "unknown",
      productivity: "neutral",
      source: "youtube",
    }));
  });

  it("keeps a short subscriptions feed visit neutral even when the title reads like a video", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      durationSeconds: 29,
      siteTitle: "구독 - YouTube",
      siteUrl: "https://www.youtube.com/feed/subscriptions",
      youtubeVideoId: null,
      youtubeCategory: null,
      windowTitle: "구독 - YouTube - Chrome",
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "unknown",
      productivity: "neutral",
      source: "youtube",
    }));
  });

  it("classifies a sustained subscriptions feed visit as drift regardless of the window title", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      durationSeconds: 45,
      siteTitle: "구독 - YouTube",
      siteUrl: "https://www.youtube.com/feed/subscriptions",
      youtubeVideoId: null,
      youtubeCategory: null,
      windowTitle: "구독 - YouTube - Chrome",
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "entertainment",
      productivity: "drift",
      source: "youtube",
    }));
  });

  it("classifies title-only YouTube video windows only when YouTube is the browser site suffix", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      siteDomain: null,
      siteTitle: null,
      siteUrl: null,
      youtubeVideoId: null,
      youtubeCategory: null,
      windowTitle: "Lecture clip - YouTube - 오디오 재생 - Chrome - Alex",
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "entertainment",
      productivity: "drift",
      source: "youtube",
      confidence: 0.7,
    }));
  });

  it("does not classify unrelated browser titles that merely mention YouTube", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      siteDomain: null,
      siteTitle: null,
      siteUrl: null,
      youtubeVideoId: null,
      youtubeCategory: null,
      windowTitle: "How YouTube affects attention - Medium - Chrome - Alex",
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "unknown",
      productivity: "neutral",
      source: "unknown",
    }));
  });

  it("does not classify YouTube search result titles as YouTube video windows", () => {
    const classification = classifyActivityDetailed(youtubeSegment({
      siteDomain: null,
      siteTitle: null,
      siteUrl: null,
      youtubeVideoId: null,
      youtubeCategory: null,
      windowTitle: "YouTube - Google 검색 - Chrome - Alex",
    }));

    expect(classification).toEqual(expect.objectContaining({
      category: "unknown",
      productivity: "neutral",
      source: "unknown",
    }));
  });
});
