import { describe, expect, it } from "vitest";
import { buildDriftAlarmCandidates, canApplyExtremeNudgeToSurface } from "./driftAlarmData";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";

function segment(id: string, startOffsetSeconds: number, durationSeconds: number, overrides?: Partial<ActivitySegment>): ActivitySegment {
  const start = new Date("2026-09-12T10:00:00.000Z");
  start.setSeconds(start.getSeconds() + startOffsetSeconds);
  const end = new Date(start);
  end.setSeconds(end.getSeconds() + durationSeconds);
  return {
    id,
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    durationSeconds,
    appName: "Aside",
    bundleId: "browser.aside",
    browserName: "Aside",
    siteDomain: "instagram.com",
    siteTitle: "Instagram",
    platform: "macos",
    source: "nsworkspace",
    ...overrides,
  };
}

const NO_AI: ClassificationOptions = {};

function buildCandidatesFromSegments(segments: ActivitySegment[]): ReturnType<typeof buildDriftAlarmCandidates> {
  return buildDriftAlarmCandidates({
    segments,
    currentSnapshot: null,
    classificationOptions: NO_AI,
    minimumDurationSeconds: 0,
  });
}

describe("sustained social dwell hard rule", () => {
  it("does not trigger for a single long segment (1 reel, 5 min)", () => {
    const segments = [segment("s1", 0, 300)];
    expect(buildCandidatesFromSegments(segments)).toHaveLength(0);
  });

  it("does not trigger for 2 segments (2 reels, 2.5 min each)", () => {
    const segments = [
      segment("s1", 0, 150),
      segment("s2", 150, 150),
    ];
    expect(buildCandidatesFromSegments(segments)).toHaveLength(0);
  });

  it("does not trigger for 3 segments (3 reels, 15s each = 45s)", () => {
    const segments = [
      segment("s1", 0, 15),
      segment("s2", 15, 15),
      segment("s3", 30, 15),
    ];
    expect(buildCandidatesFromSegments(segments)).toHaveLength(0);
  });

  it("does not trigger for 4 segments under 60s total (4 reels, 10s each = 40s)", () => {
    const segments = [
      segment("s1", 0, 10),
      segment("s2", 10, 10),
      segment("s3", 20, 10),
      segment("s4", 30, 10),
    ];
    expect(buildCandidatesFromSegments(segments)).toHaveLength(0);
  });

  it("triggers for 4 segments at 15-20s each (≥ 4 segments, ≥ 60s)", () => {
    const segments = [
      segment("s1", 0, 20),
      segment("s2", 20, 15),
      segment("s3", 35, 15),
      segment("s4", 50, 15),
    ];
    const candidates = buildCandidatesFromSegments(segments);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      category: "social_media",
      classification: expect.objectContaining({
        productivity: "drift",
        source: "sustained-social-dwell",
      }),
    });
  });

  it("triggers for 5 segments totalling 80s on TikTok", () => {
    const segments = [
      segment("s1", 0, 16, { siteDomain: "tiktok.com", siteTitle: "TikTok" }),
      segment("s2", 16, 16, { siteDomain: "tiktok.com", siteTitle: "TikTok" }),
      segment("s3", 32, 16, { siteDomain: "tiktok.com", siteTitle: "TikTok" }),
      segment("s4", 48, 16, { siteDomain: "tiktok.com", siteTitle: "TikTok" }),
      segment("s5", 64, 16, { siteDomain: "tiktok.com", siteTitle: "TikTok" }),
    ];
    const candidates = buildCandidatesFromSegments(segments);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].classification.source).toBe("sustained-social-dwell");
  });

  it("does not trigger when a DM segment breaks the chain", () => {
    const segments = [
      segment("s1", 0, 20),
      segment("s2", 20, 15),
      // DM check breaks the chain
      segment("s3", 35, 10, { siteUrl: "https://instagram.com/direct/inbox" }),
      segment("s4", 45, 20),
      segment("s5", 65, 15),
    ];
    expect(buildCandidatesFromSegments(segments)).toHaveLength(0);
  });

  it("does not trigger when segments span different social sites", () => {
    const segments = [
      segment("s1", 0, 20, { siteDomain: "instagram.com" }),
      segment("s2", 20, 20, { siteDomain: "instagram.com" }),
      segment("s3", 40, 20, { siteDomain: "tiktok.com" }),
      segment("s4", 60, 20, { siteDomain: "tiktok.com" }),
    ];
    expect(buildCandidatesFromSegments(segments)).toHaveLength(0);
  });

  it("allows automatic close for sustained-social-dwell candidates", () => {
    const seg = segment("s1", 0, 20);
    expect(canApplyExtremeNudgeToSurface({
      segment: seg,
      category: "social_media",
      aiConfirmedDrift: false,
      classificationSource: "sustained-social-dwell",
    })).toBe(true);
  });

  it("does not trigger when a gap > 15s separates segments", () => {
    const segments = [
      segment("s1", 0, 15),
      segment("s2", 15, 15),
      // 20-second gap before the next segment
      segment("s3", 50, 20),
      segment("s4", 70, 15),
    ];
    expect(buildCandidatesFromSegments(segments)).toHaveLength(0);
  });

  it("respects the configured minimumDurationSeconds threshold", () => {
    const segments = [
      segment("s1", 0, 20),
      segment("s2", 20, 15),
      segment("s3", 35, 15),
      segment("s4", 50, 15),
    ];
    // 65s total dwell, but threshold set to 120s
    const candidates = buildDriftAlarmCandidates({
      segments,
      currentSnapshot: null,
      classificationOptions: NO_AI,
      minimumDurationSeconds: 120,
    });
    expect(candidates).toHaveLength(0);
  });

  it("does not override a user classification rule marking instagram as focus", () => {
    const segments = [
      segment("s1", 0, 20),
      segment("s2", 20, 15),
      segment("s3", 35, 15),
      segment("s4", 50, 15),
    ];
    // When a user has a rule like "instagram.com → focus", every segment
    // gets classified with source: "rule". The hard rule must respect that.
    const candidates = buildDriftAlarmCandidates({
      segments,
      currentSnapshot: null,
      classificationOptions: {
        rules: [{ targetKind: "site", targetValue: "instagram.com", category: "workspace", productivity: "focus" }],
      },
      minimumDurationSeconds: 0,
    });
    expect(candidates).toHaveLength(0);
  });

  it("does not override a manual correction on the current segment", () => {
    const segments = [
      segment("s1", 0, 20),
      segment("s2", 20, 15),
      segment("s3", 35, 15),
      // The latest segment has a stored manual correction
      segment("s4", 50, 15, {
        classification: {
          category: "workspace",
          productivity: "focus",
          source: "manual",
          confidence: 1,
          reason: "User marked as focus",
        },
      }),
    ];
    const candidates = buildCandidatesFromSegments(segments);
    expect(candidates).toHaveLength(0);
  });

  it("triggers for X (twitter.com) doomscrolling", () => {
    const segments = [
      segment("s1", 0, 18, { siteDomain: "x.com", siteTitle: "X" }),
      segment("s2", 18, 16, { siteDomain: "x.com", siteTitle: "X" }),
      segment("s3", 34, 15, { siteDomain: "x.com", siteTitle: "X" }),
      segment("s4", 49, 16, { siteDomain: "x.com", siteTitle: "X" }),
    ];
    const candidates = buildCandidatesFromSegments(segments);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].classification.source).toBe("sustained-social-dwell");
  });

  it("does not trigger when messages path appears on X", () => {
    const segments = [
      segment("s1", 0, 18, { siteDomain: "x.com" }),
      segment("s2", 18, 16, { siteDomain: "x.com" }),
      segment("s3", 34, 15, { siteDomain: "x.com", siteUrl: "https://x.com/messages" }),
      segment("s4", 49, 16, { siteDomain: "x.com" }),
      segment("s5", 65, 16, { siteDomain: "x.com" }),
    ];
    expect(buildCandidatesFromSegments(segments)).toHaveLength(0);
  });


  it("triggers for YouTube Shorts when AI overrides individual segments as focus", () => {
    // When AI previously classified individual Shorts segments as focus/learning,
    // the sustained dwell pattern (4+ segments, 60s+) should override that.
    const segments = [
      segment("s1", 0, 18, {
        siteDomain: "youtube.com", siteTitle: "Shorts", youtubeIsShorts: true,
        classification: { category: "learning", productivity: "focus", source: "llm", confidence: 0.9, reason: "Educational shorts" },
      }),
      segment("s2", 18, 16, {
        siteDomain: "youtube.com", siteTitle: "Shorts", youtubeIsShorts: true,
        classification: { category: "learning", productivity: "focus", source: "llm", confidence: 0.88, reason: "Tutorial content" },
      }),
      segment("s3", 34, 15, {
        siteDomain: "youtube.com", siteTitle: "Shorts", youtubeIsShorts: true,
        classification: { category: "learning", productivity: "focus", source: "llm", confidence: 0.92, reason: "How-to video" },
      }),
      segment("s4", 49, 16, {
        siteDomain: "youtube.com", siteTitle: "Shorts", youtubeIsShorts: true,
        classification: { category: "learning", productivity: "focus", source: "llm", confidence: 0.87, reason: "Tech tips" },
      }),
    ];
    const candidates = buildCandidatesFromSegments(segments);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      category: "entertainment",
      classification: expect.objectContaining({
        productivity: "drift",
        source: "sustained-social-dwell",
      }),
    });
  });

  it("does not fire for YouTube Shorts that are already classified as drift", () => {
    // Normal YouTube Shorts without stored overrides → already drift via youtube source.
    // The normal drift alarm path handles these, not the sustained dwell rule.
    const segments = [
      segment("s1", 0, 18, { siteDomain: "youtube.com", youtubeIsShorts: true }),
      segment("s2", 18, 16, { siteDomain: "youtube.com", youtubeIsShorts: true }),
      segment("s3", 34, 15, { siteDomain: "youtube.com", youtubeIsShorts: true }),
      segment("s4", 49, 16, { siteDomain: "youtube.com", youtubeIsShorts: true }),
    ];
    const candidates = buildCandidatesFromSegments(segments);
    // Candidates are produced by the NORMAL drift path, not sustained dwell
    expect(candidates).toHaveLength(1);
    expect(candidates[0].classification.source).not.toBe("sustained-social-dwell");
  });

  it("does not fire for regular YouTube videos (already drift by default)", () => {
    const segments = [
      segment("s1", 0, 300, { siteDomain: "youtube.com", siteUrl: "https://youtube.com/watch?v=aaa" }),
      segment("s2", 300, 300, { siteDomain: "youtube.com", siteUrl: "https://youtube.com/watch?v=bbb" }),
      segment("s3", 600, 300, { siteDomain: "youtube.com", siteUrl: "https://youtube.com/watch?v=ccc" }),
      segment("s4", 900, 300, { siteDomain: "youtube.com", siteUrl: "https://youtube.com/watch?v=ddd" }),
    ];
    const candidates = buildCandidatesFromSegments(segments);
    // Normal drift path handles these
    expect(candidates).toHaveLength(1);
    expect(candidates[0].classification.source).not.toBe("sustained-social-dwell");
  });
});

