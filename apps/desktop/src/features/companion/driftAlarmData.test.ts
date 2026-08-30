import { describe, expect, it } from "vitest";

import { buildDriftAlarmCandidates, canApplyExtremeNudgeToCategory, normalizeDriftAlertDelaySeconds } from "./driftAlarmData";
import type { ActivitySegment, ClassificationOptions, CurrentActivitySnapshot, StoredActivityClassification } from "@drifty/domain";

const driftSegment: ActivitySegment = {
  id: "seg-1",
  startedAt: "2026-06-11T09:00:00.000Z",
  endedAt: "2026-06-11T09:10:00.000Z",
  durationSeconds: 600,
  appName: "Safari",
  bundleId: "com.apple.Safari",
  windowTitle: "Netflix",
  browserName: "Safari",
  siteDomain: "netflix.com",
  siteTitle: "Netflix",
  platform: "macos",
  source: "nsworkspace",
};

const currentSnapshot: CurrentActivitySnapshot = {
  observedAt: "2026-06-11T09:10:00.000Z",
  appName: "Safari",
  bundleId: "com.apple.Safari",
  windowTitle: "Netflix",
  browserName: "Safari",
  siteDomain: "netflix.com",
  siteTitle: "Netflix",
  source: "nsworkspace",
};

function buildCandidates(classificationOptions: ClassificationOptions) {
  return buildDriftAlarmCandidates({
    segments: [driftSegment],
    currentSnapshot,
    classificationOptions,
    minimumDurationSeconds: 0,
  });
}

describe("buildDriftAlarmCandidates", () => {
  it("flags a live drift snapshot without a correction rule", () => {
    const candidates = buildCandidates({});

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      alertKey: "drift-episode:seg-1",
      episodeKey: "drift-episode:seg-1",
      driftDurationSeconds: 600,
      category: "entertainment",
      sourceSegmentId: "seg-1",
      classification: expect.objectContaining({
        category: "entertainment",
        productivity: "drift",
      }),
      segment: expect.objectContaining({
        id: "seg-1",
        durationSeconds: 600,
      }),
    });
  });

  it("suppresses a resolver-adjusted low-confidence AI drift", () => {
    const adjustedSegment: ActivitySegment = {
      ...driftSegment,
      classification: storedClassification("game", "drift", 0.5),
    };

    const candidates = buildDriftAlarmCandidates({
      segments: [adjustedSegment],
      currentSnapshot,
      classificationOptions: { includeAiClassifications: true },
      minimumDurationSeconds: 0,
    });

    expect(candidates).toEqual([]);
  });

  it("extends the stored segment duration only while the current snapshot still matches it", () => {
    const candidates = buildDriftAlarmCandidates({
      segments: [driftSegment],
      currentSnapshot: { ...currentSnapshot, observedAt: "2026-06-11T09:10:30.000Z" },
      classificationOptions: {},
      minimumDurationSeconds: 0,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      alertKey: "drift-episode:seg-1",
      episodeKey: "drift-episode:seg-1",
      driftDurationSeconds: 630,
      sourceSegmentId: "seg-1",
      segment: expect.objectContaining({
        id: "seg-1",
        endedAt: "2026-06-11T09:10:30.000Z",
        durationSeconds: 630,
      }),
    });
  });

  it("uses a continuous same-site drift episode for the alert delay", () => {
    const firstReel: ActivitySegment = {
      ...driftSegment,
      id: "reel-a",
      startedAt: "2026-06-11T09:00:00.000Z",
      endedAt: "2026-06-11T09:00:25.000Z",
      durationSeconds: 25,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: "Instagram Reel A",
      siteDomain: "instagram.com",
      siteTitle: "Instagram Reel A",
      siteUrl: "https://www.instagram.com/reel/AAA/",
    };
    const currentReel: ActivitySegment = {
      ...firstReel,
      id: "reel-b",
      startedAt: "2026-06-11T09:00:30.000Z",
      endedAt: "2026-06-11T09:00:55.000Z",
      windowTitle: "Instagram Reel B",
      siteTitle: "Instagram Reel B",
      siteUrl: "https://www.instagram.com/reel/BBB/",
    };
    const reelSnapshot: CurrentActivitySnapshot = {
      ...currentSnapshot,
      observedAt: "2026-06-11T09:01:05.000Z",
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: "Instagram Reel B",
      siteDomain: "instagram.com",
      siteTitle: "Instagram Reel B",
      siteUrl: "https://www.instagram.com/reel/BBB/",
    };

    const candidates = buildDriftAlarmCandidates({
      segments: [firstReel, currentReel],
      currentSnapshot: reelSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 60,
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        alertKey: "drift-episode:reel-a",
        episodeKey: "drift-episode:reel-a",
        driftDurationSeconds: 60,
        sourceSegmentId: "reel-b",
        segment: expect.objectContaining({
          id: "reel-b",
          durationSeconds: 35,
          siteUrl: "https://www.instagram.com/reel/BBB/",
        }),
      }),
    ]);
  });

  it("accumulates consecutive YouTube Shorts with different video ids", () => {
    const firstShort: ActivitySegment = {
      ...driftSegment,
      id: "short-a",
      startedAt: "2026-06-11T09:00:00.000Z",
      endedAt: "2026-06-11T09:00:25.000Z",
      durationSeconds: 25,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: "YouTube Short A",
      siteDomain: "youtube.com",
      siteTitle: "YouTube Short A",
      siteUrl: "https://www.youtube.com/shorts/AAAAAAAAAAA",
      youtubeVideoId: "AAAAAAAAAAA",
      youtubeIsShorts: true,
    };
    const currentShort: ActivitySegment = {
      ...firstShort,
      id: "short-b",
      startedAt: "2026-06-11T09:00:30.000Z",
      endedAt: "2026-06-11T09:00:55.000Z",
      windowTitle: "YouTube Short B",
      siteTitle: "YouTube Short B",
      siteUrl: "https://www.youtube.com/shorts/BBBBBBBBBBB",
      youtubeVideoId: "BBBBBBBBBBB",
    };

    const candidates = buildDriftAlarmCandidates({
      segments: [firstShort, currentShort],
      currentSnapshot: {
        ...currentSnapshot,
        observedAt: "2026-06-11T09:01:05.000Z",
        appName: "Google Chrome",
        bundleId: "com.google.Chrome",
        browserName: "Google Chrome",
        windowTitle: "YouTube Short B",
        siteDomain: "youtube.com",
        siteTitle: "YouTube Short B",
        siteUrl: "https://www.youtube.com/shorts/BBBBBBBBBBB",
        youtubeVideoId: "BBBBBBBBBBB",
        youtubeIsShorts: true,
      },
      classificationOptions: {},
      minimumDurationSeconds: 60,
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        episodeKey: "drift-episode:short-a",
        driftDurationSeconds: 60,
        sourceSegmentId: "short-b",
        segment: expect.objectContaining({
          id: "short-b",
          youtubeVideoId: "BBBBBBBBBBB",
        }),
      }),
    ]);
  });

  it("does not carry same-site drift across a focus segment", () => {
    const firstReel: ActivitySegment = {
      ...driftSegment,
      id: "reel-before-focus",
      startedAt: "2026-06-11T09:00:00.000Z",
      endedAt: "2026-06-11T09:00:25.000Z",
      durationSeconds: 25,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: "Instagram Reel",
      siteDomain: "instagram.com",
      siteTitle: "Instagram Reel",
      siteUrl: "https://www.instagram.com/reel/AAA/",
    };
    const focusResearch: ActivitySegment = {
      ...firstReel,
      id: "instagram-focus-research",
      startedAt: "2026-06-11T09:00:30.000Z",
      endedAt: "2026-06-11T09:00:40.000Z",
      durationSeconds: 10,
      siteUrl: "https://www.instagram.com/reel/research/",
      classification: storedClassification("workspace", "focus", 0.96),
    };
    const currentReel: ActivitySegment = {
      ...firstReel,
      id: "reel-after-focus",
      startedAt: "2026-06-11T09:00:45.000Z",
      endedAt: "2026-06-11T09:01:10.000Z",
      durationSeconds: 25,
      siteUrl: "https://www.instagram.com/reel/BBB/",
    };

    const candidates = buildDriftAlarmCandidates({
      segments: [firstReel, focusResearch, currentReel],
      currentSnapshot: {
        ...currentSnapshot,
        observedAt: currentReel.endedAt,
        appName: currentReel.appName,
        bundleId: currentReel.bundleId,
        browserName: currentReel.browserName,
        windowTitle: currentReel.windowTitle,
        siteDomain: currentReel.siteDomain,
        siteTitle: currentReel.siteTitle,
        siteUrl: currentReel.siteUrl,
      },
      classificationOptions: {},
      minimumDurationSeconds: 30,
    });

    expect(candidates).toEqual([]);
  });

  it("does not flag a stored drift segment after the current snapshot moves elsewhere", () => {
    const candidates = buildDriftAlarmCandidates({
      segments: [driftSegment],
      currentSnapshot: {
        ...currentSnapshot,
        appName: "Code",
        bundleId: "com.microsoft.VSCode",
        windowTitle: "Back in code",
        browserName: null,
        siteDomain: null,
        siteTitle: null,
      },
      classificationOptions: {},
      minimumDurationSeconds: 0,
    });

    expect(candidates).toEqual([]);
  });

  it("suppresses the same window after a Not a drift correction rule", () => {
    const candidates = buildCandidates({
      rules: [{ targetKind: "site", targetValue: "netflix.com", category: "entertainment", productivity: "neutral", enabled: true }],
    });

    expect(candidates).toEqual([]);
  });

  it("suppresses an app-target correction rule for non-browser windows", () => {
    const gameSegment: ActivitySegment = {
      ...driftSegment,
      id: "seg-2",
      appName: "League of Legends",
      bundleId: "com.riotgames.LeagueofLegends",
      windowTitle: "Summoner's Rift",
      browserName: null,
      siteDomain: null,
      siteTitle: null,
    };
    const gameSnapshot: CurrentActivitySnapshot = {
      ...currentSnapshot,
      appName: "League of Legends",
      bundleId: "com.riotgames.LeagueofLegends",
      windowTitle: "Summoner's Rift",
      browserName: null,
      siteDomain: null,
      siteTitle: null,
    };

    const withoutRule = buildDriftAlarmCandidates({
      segments: [gameSegment],
      currentSnapshot: gameSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 0,
    });
    const withRule = buildDriftAlarmCandidates({
      segments: [gameSegment],
      currentSnapshot: gameSnapshot,
      classificationOptions: {
        rules: [{ targetKind: "app", targetValue: "com.riotgames.LeagueofLegends", category: "game", productivity: "neutral", enabled: true }],
      },
      minimumDurationSeconds: 0,
    });

    expect(withoutRule).toHaveLength(1);
    expect(withRule).toEqual([]);
  });

  it("suppresses live app LLM drift outliers when app history is dominantly focus", () => {
    const currentAppSegment: ActivitySegment = {
      ...driftSegment,
      id: "obsidian-current",
      startedAt: "2026-06-11T09:00:00.000Z",
      endedAt: "2026-06-11T09:10:00.000Z",
      durationSeconds: 600,
      appName: "Obsidian",
      bundleId: "md.obsidian",
      windowTitle: "Instagram reels notes",
      browserName: null,
      siteDomain: null,
      siteTitle: null,
      classification: storedClassification("social_media", "drift", 0.96),
    };
    const appSnapshot: CurrentActivitySnapshot = {
      ...currentSnapshot,
      observedAt: "2026-06-11T09:10:00.000Z",
      appName: "Obsidian",
      bundleId: "md.obsidian",
      windowTitle: "Instagram reels notes",
      browserName: null,
      siteDomain: null,
      siteTitle: null,
    };

    const candidates = buildDriftAlarmCandidates({
      segments: [...obsidianFocusHistorySegments(), currentAppSegment],
      currentSnapshot: appSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 0,
    });

    expect(candidates).toEqual([]);
  });

  it("suppresses live app LLM drift during app cold start", () => {
    const currentAppSegment: ActivitySegment = {
      ...driftSegment,
      id: "new-app-current",
      appName: "Obsidian",
      bundleId: "md.obsidian",
      windowTitle: "Instagram reels notes",
      browserName: null,
      siteDomain: null,
      siteTitle: null,
      classification: storedClassification("social_media", "drift", 0.96),
    };
    const appSnapshot: CurrentActivitySnapshot = {
      ...currentSnapshot,
      appName: "Obsidian",
      bundleId: "md.obsidian",
      windowTitle: "Instagram reels notes",
      browserName: null,
      siteDomain: null,
      siteTitle: null,
    };

    const candidates = buildDriftAlarmCandidates({
      segments: [currentAppSegment],
      currentSnapshot: appSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 0,
    });

    expect(candidates).toEqual([]);
  });

  it("suppresses live YouTube radio playlist drift alarms from the matching history URL", () => {
    const playlistSegment: ActivitySegment = {
      ...driftSegment,
      id: "youtube-playlist-segment",
      windowTitle: "Summer playlist",
      siteDomain: "youtube.com",
      siteTitle: "Summer playlist - YouTube",
      siteUrl: "https://www.youtube.com/watch?v=MusicQA0001&list=RDMusicQA0001&start_radio=1",
      youtubeVideoId: "MusicQA0001",
    };
    const playlistSnapshot: CurrentActivitySnapshot = {
      ...currentSnapshot,
      observedAt: "2026-06-11T09:10:30.000Z",
      windowTitle: "Summer playlist",
      siteDomain: "youtube.com",
      siteTitle: "Summer playlist - YouTube",
      siteUrl: "https://www.youtube.com/watch?v=MusicQA0001",
      youtubeVideoId: "MusicQA0001",
      youtubePlaylistId: null,
    };

    const candidates = buildDriftAlarmCandidates({
      segments: [playlistSegment],
      currentSnapshot: playlistSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 0,
    });

    expect(candidates).toEqual([]);
  });

  it("defers live browser drift while history title matching can still backfill", () => {
    const pendingSegment: ActivitySegment = {
      ...driftSegment,
      id: "history-pending-segment",
      startedAt: "2026-06-11T09:00:00.000Z",
      endedAt: "2026-06-11T09:00:20.000Z",
      durationSeconds: 20,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: "Lecture - YouTube - Google Chrome",
      siteDomain: null,
      siteTitle: null,
      siteUrl: null,
      browserHistoryStatus: "no_match",
      browserHistoryReason: "outside_time_window",
    };
    const pendingSnapshot: CurrentActivitySnapshot = {
      ...currentSnapshot,
      observedAt: "2026-06-11T09:01:00.000Z",
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: "Lecture - YouTube - Google Chrome",
      siteDomain: null,
      siteTitle: null,
      siteUrl: null,
      browserHistoryStatus: "no_match",
      browserHistoryReason: "outside_time_window",
    };

    const candidates = buildDriftAlarmCandidates({
      segments: [pendingSegment],
      currentSnapshot: pendingSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 0,
    });

    expect(candidates).toEqual([]);
  });

  it("allows browser drift after the history title backfill window expires", () => {
    const expiredSegment: ActivitySegment = {
      ...driftSegment,
      id: "history-expired-segment",
      startedAt: "2026-06-11T09:00:00.000Z",
      endedAt: "2026-06-11T09:00:20.000Z",
      durationSeconds: 20,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: "Lecture - YouTube - Google Chrome",
      siteDomain: null,
      siteTitle: null,
      siteUrl: null,
      browserHistoryStatus: "no_match",
      browserHistoryReason: "no_match",
    };
    const expiredSnapshot: CurrentActivitySnapshot = {
      ...currentSnapshot,
      observedAt: "2026-06-11T09:03:01.000Z",
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: "Lecture - YouTube - Google Chrome",
      siteDomain: null,
      siteTitle: null,
      siteUrl: null,
      browserHistoryStatus: "no_match",
      browserHistoryReason: "no_match",
    };

    const candidates = buildDriftAlarmCandidates({
      segments: [expiredSegment],
      currentSnapshot: expiredSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 0,
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        alertKey: "drift-episode:history-expired-segment",
        episodeKey: "drift-episode:history-expired-segment",
        category: "entertainment",
        sourceSegmentId: "history-expired-segment",
      }),
    ]);
  });

  it("flags a live YouTube feed drift candidate after thirty seconds", () => {
    const feedSegment: ActivitySegment = {
      ...driftSegment,
      id: "youtube-feed-segment",
      startedAt: "2026-06-11T09:00:00.000Z",
      endedAt: "2026-06-11T09:00:15.000Z",
      durationSeconds: 15,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: "YouTube",
      siteDomain: "youtube.com",
      siteTitle: "YouTube",
      siteUrl: "https://www.youtube.com/feed",
      youtubeVideoId: null,
    };
    const feedSnapshot: CurrentActivitySnapshot = {
      ...currentSnapshot,
      observedAt: "2026-06-11T09:00:30.000Z",
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      windowTitle: "YouTube",
      siteDomain: "youtube.com",
      siteTitle: "YouTube",
      siteUrl: "https://www.youtube.com/feed",
      youtubeVideoId: null,
    };

    const candidates = buildDriftAlarmCandidates({
      segments: [feedSegment],
      currentSnapshot: feedSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 30,
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        alertKey: "drift-episode:youtube-feed-segment",
        episodeKey: "drift-episode:youtube-feed-segment",
        driftDurationSeconds: 30,
        category: "entertainment",
        sourceSegmentId: "youtube-feed-segment",
        segment: expect.objectContaining({
          durationSeconds: 30,
          siteUrl: "https://www.youtube.com/feed",
        }),
      }),
    ]);
  });
});

describe("normalizeDriftAlertDelaySeconds", () => {
  it("defaults to 30s when no saved timing exists", () => {
    expect(normalizeDriftAlertDelaySeconds(null)).toBe(30);
    expect(normalizeDriftAlertDelaySeconds("")).toBe(30);
  });

  it("keeps explicit supported timings", () => {
    expect(normalizeDriftAlertDelaySeconds(0)).toBe(0);
    expect(normalizeDriftAlertDelaySeconds("30")).toBe(30);
    expect(normalizeDriftAlertDelaySeconds("60")).toBe(60);
    expect(normalizeDriftAlertDelaySeconds("120")).toBe(120);
    expect(normalizeDriftAlertDelaySeconds("300")).toBe(300);
    expect(normalizeDriftAlertDelaySeconds("600")).toBe(600);
    expect(normalizeDriftAlertDelaySeconds("900")).toBe(900);
    expect(normalizeDriftAlertDelaySeconds("1800")).toBe(1800);
  });
});

describe("canApplyExtremeNudgeToCategory", () => {
  it("blocks app-closing nudges for communication activity", () => {
    expect(canApplyExtremeNudgeToCategory("communication")).toBe(false);
    expect(canApplyExtremeNudgeToCategory("entertainment")).toBe(true);
    expect(canApplyExtremeNudgeToCategory("game")).toBe(true);
  });
});

function obsidianFocusHistorySegments(): ActivitySegment[] {
  const segments: ActivitySegment[] = [];
  for (let index = 0; index < 6; index += 1) {
    const startedAtMs = Date.UTC(2026, 5, 11, 7, index * 10, 0, 0);
    segments.push({
      ...driftSegment,
      id: `obsidian-focus-${index}`,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(startedAtMs + 10 * 60 * 1000).toISOString(),
      durationSeconds: 10 * 60,
      appName: "Obsidian",
      bundleId: "md.obsidian",
      windowTitle: "Project notes",
      browserName: null,
      siteDomain: null,
      siteTitle: null,
      classification: storedClassification("workspace", "focus", 0.94),
    });
  }
  return segments;
}

function storedClassification(
  category: StoredActivityClassification["category"],
  productivity: StoredActivityClassification["productivity"],
  confidence: number,
): StoredActivityClassification {
  return {
    source: "llm",
    category,
    productivity,
    confidence,
    reason: "test classification",
    aiResult: true,
  };
}
