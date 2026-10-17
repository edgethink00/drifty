import { classifyActivityDetailed, type ActivityClassificationRecord, type ActivitySegment } from "@drifty/domain";
import { describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_HEURISTIC_TAXONOMY_VERSION,
  materializeBuiltInHeuristicClassifications,
  persistBuiltInHeuristicClassifications,
} from "./heuristicClassificationMaterialization";

const CLASSIFIED_AT = "2026-06-18T00:00:00.000Z";

function segment(overrides: Partial<ActivitySegment>): ActivitySegment {
  return {
    id: "segment-1",
    startedAt: "2026-06-18T00:00:00.000Z",
    endedAt: "2026-06-18T00:05:00.000Z",
    durationSeconds: 300,
    appName: "Unknown",
    bundleId: null,
    windowTitle: null,
    browserName: null,
    siteDomain: null,
    siteTitle: null,
    siteUrl: null,
    platform: "macos",
    source: "nsworkspace",
    classification: null,
    ...overrides,
  };
}

function storedClassification(
  source: ActivityClassificationRecord["source"],
  overrides: Partial<NonNullable<ActivitySegment["classification"]>> = {},
): NonNullable<ActivitySegment["classification"]> {
  return {
    category: "workspace",
    productivity: "focus",
    source,
    confidence: 0.9,
    reason: "Stored test classification",
    model: null,
    promptVersion: null,
    taxonomyVersion: "v1",
    inputFingerprint: "stored:test",
    classifiedAt: CLASSIFIED_AT,
    aiResult: source === "llm",
    stale: false,
    ...overrides,
  };
}

describe("materializeBuiltInHeuristicClassifications", () => {
  it("keeps a newly captured video without official metadata available to classification", () => {
    const captured = segment({ id: "uncached-video", appName: "Chrome", browserName: "Chrome",
      siteDomain: "youtube.com", siteUrl: "https://www.youtube.com/watch?v=uncached",
      youtubeVideoId: "uncached", siteTitle: "A lecture - YouTube", youtubeCategory: null });
    const result = materializeBuiltInHeuristicClassifications({ segments: [captured] });
    expect(result.classifications).toEqual([]);
    expect(result.segments[0].classification).toBe(captured.classification);
  });

  it("stores app domain and youtube built-in heuristic results when no authoritative row exists", () => {
    const appSegment = segment({ id: "app", appName: "Xcode", bundleId: "com.apple.dt.xcode" });
    const domainSegment = segment({
      id: "domain",
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: "developer.mozilla.org",
      siteTitle: "MDN",
    });
    const youtubeSegment = segment({
      id: "youtube",
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: "youtube.com",
      siteUrl: "https://www.youtube.com/watch?v=abc",
      youtubeVideoId: "abc",
      youtubeCategory: "Education",
    });
    const unknownSegment = segment({ id: "unknown", appName: "Made Up App" });

    const result = materializeBuiltInHeuristicClassifications({
      classifiedAt: CLASSIFIED_AT,
      classificationOptions: { rules: [] },
      segments: [appSegment, domainSegment, youtubeSegment, unknownSegment],
    });

    expect(result.classifications).toEqual([
      expect.objectContaining({ segmentId: "app", source: "app-db", category: "workspace", productivity: "focus" }),
      expect.objectContaining({ segmentId: "domain", source: "domain-db", category: "learning", productivity: "focus" }),
      expect.objectContaining({ segmentId: "youtube", source: "youtube", category: "learning", productivity: "focus" }),
    ]);
    expect(result.classifications.every((record) => record.taxonomyVersion === BUILT_IN_HEURISTIC_TAXONOMY_VERSION)).toBe(true);
    expect(result.segments.find((item) => item.id === "app")?.classification?.source).toBe("app-db");
    expect(result.segments.find((item) => item.id === "unknown")?.classification).toBeNull();
  });

  it("leaves a YouTube video decided by its official category to the classifier while descriptions exist", () => {
    const video = segment({
      id: "video",
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: "youtube.com",
      siteUrl: "https://www.youtube.com/watch?v=abc",
      youtubeVideoId: "abc",
      youtubeCategory: "Education",
    });
    const shorts = segment({ ...video, id: "shorts", siteUrl: "https://www.youtube.com/shorts/xyz", youtubeVideoId: "xyz", youtubeIsShorts: true });
    const app = segment({ id: "app", appName: "Xcode", bundleId: "com.apple.dt.xcode" });

    const guided = materializeBuiltInHeuristicClassifications({
      classifiedAt: CLASSIFIED_AT,
      classificationOptions: { rules: [] },
      segments: [video, shorts, app],
      leaveYouTubeVideosToClassifier: true,
    });
    expect(guided.classifications.map((record) => record.segmentId)).toEqual(["shorts", "app"]);
    expect(guided.segments.find((item) => item.id === "video")?.classification).toBeNull();

    const unguided = materializeBuiltInHeuristicClassifications({
      classifiedAt: CLASSIFIED_AT,
      classificationOptions: { rules: [] },
      segments: [video, shorts, app],
    });
    expect(unguided.classifications.map((record) => record.segmentId)).toEqual(["video", "shorts", "app"]);
  });

  it("does not overwrite manual AI or persisted custom rule classifications", () => {
    const segments = [
      segment({ id: "manual", appName: "Xcode", classification: storedClassification("manual") }),
      segment({ id: "ai", appName: "Xcode", classification: storedClassification("llm") }),
      segment({ id: "custom-rule", appName: "Xcode", classification: storedClassification("rule", { classificationRuleId: "rule-1" }) }),
      segment({ id: "synced-rule", appName: "Xcode", classification: storedClassification("rule", { ruleSnapshotKind: "synced-rule" }) }),
      segment({ id: "stamped-rule", appName: "Xcode", classification: storedClassification("rule", { classificationRuleId: null }) }),
    ];

    const result = materializeBuiltInHeuristicClassifications({
      classifiedAt: CLASSIFIED_AT,
      classificationOptions: { rules: [] },
      segments,
    });

    expect(result.classifications).toEqual([
      expect.objectContaining({ segmentId: "stamped-rule", source: "app-db" }),
    ]);
    expect(result.segments.find((item) => item.id === "manual")?.classification?.source).toBe("manual");
    expect(result.segments.find((item) => item.id === "ai")?.classification?.source).toBe("llm");
    expect(result.segments.find((item) => item.id === "custom-rule")?.classification?.source).toBe("rule");
    expect(result.segments.find((item) => item.id === "synced-rule")?.classification?.source).toBe("rule");
  });

  it("reuses stored built-in sources without falling back to generic stored classification", () => {
    const persistedDomainSegment = segment({
      id: "persisted-domain",
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: "developer.mozilla.org",
      classification: storedClassification("domain-db", {
        category: "learning",
        productivity: "focus",
        taxonomyVersion: BUILT_IN_HEURISTIC_TAXONOMY_VERSION,
      }),
    });

    const classification = classifyActivityDetailed(persistedDomainSegment);
    const result = materializeBuiltInHeuristicClassifications({
      classifiedAt: CLASSIFIED_AT,
      segments: [persistedDomainSegment],
    });

    expect(classification).toMatchObject({ source: "domain-db", category: "learning", productivity: "focus" });
    expect(result.classifications).toEqual([]);
    expect(result.segments[0]).toBe(persistedDomainSegment);
  });

  it("refreshes stored neutral YouTube feed rows after the feed duration crosses thirty seconds", () => {
    const persistedFeedSegment = segment({
      id: "persisted-youtube-feed",
      appName: "Google Chrome",
      browserName: "Google Chrome",
      siteDomain: "youtube.com",
      siteTitle: "YouTube",
      siteUrl: "https://www.youtube.com/feed",
      durationSeconds: 30,
      classification: storedClassification("youtube", {
        category: "unknown",
        productivity: "neutral",
        taxonomyVersion: BUILT_IN_HEURISTIC_TAXONOMY_VERSION,
      }),
    });

    const result = materializeBuiltInHeuristicClassifications({
      classifiedAt: CLASSIFIED_AT,
      segments: [persistedFeedSegment],
    });

    expect(result.classifications).toEqual([
      expect.objectContaining({
        segmentId: "persisted-youtube-feed",
        source: "youtube",
        category: "entertainment",
        productivity: "drift",
      }),
    ]);
    expect(result.segments[0]?.classification).toEqual(expect.objectContaining({
      category: "entertainment",
      productivity: "drift",
      source: "youtube",
    }));
  });

  it("rechecks availability after yielding and before a scheduled batch reaches storage", async () => {
    const result = materializeBuiltInHeuristicClassifications({
      classifiedAt: CLASSIFIED_AT,
      segments: [segment({ id: "late-save", appName: "Xcode", bundleId: "com.apple.dt.xcode" })],
    });
    const saveClassifications = vi.fn().mockResolvedValue({ saved: 1 });
    let checks = 0;

    const saved = await persistBuiltInHeuristicClassifications(
      result.classifications,
      saveClassifications,
      () => {
        checks += 1;
        return checks === 1;
      },
    );

    expect(saved).toBe(0);
    expect(saveClassifications).not.toHaveBeenCalled();
  });
});
