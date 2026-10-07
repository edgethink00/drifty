import { describe, expect, it } from "vitest";
import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";

import { resolveLiveDriftAlarmAiCandidate } from "./liveDriftAlarmAiCandidate";

const gameSegment: ActivitySegment = {
  id: "survev-1",
  startedAt: "2026-06-15T19:15:18.000Z",
  endedAt: "2026-06-15T19:22:00.000Z",
  durationSeconds: 402,
  appName: "Google Chrome",
  bundleId: "com.google.Chrome",
  windowTitle: "survev.io - 2d battle royale game - Chrome",
  browserName: "Google Chrome",
  siteDomain: "survev.io",
  siteTitle: "survev.io - 2d battle royale game",
  siteUrl: "https://survev.io/",
  platform: "macos",
  source: "accessibility",
};

const gameSnapshot: CurrentActivitySnapshot = {
  observedAt: "2026-06-15T19:23:00.000Z",
  appName: "Google Chrome",
  bundleId: "com.google.Chrome",
  windowTitle: "survev.io - 2d battle royale game - Chrome",
  browserName: "Google Chrome",
  siteDomain: "survev.io",
  siteTitle: "survev.io - 2d battle royale game",
  siteUrl: "https://survev.io/",
  source: "accessibility",
};

describe("resolveLiveDriftAlarmAiCandidate", () => {
  it.each(["instagram.com", "tiktok.com"])("waits for the new %s page's own captured record before selecting live AI", siteDomain => {
    const video: ActivitySegment = {
      ...gameSegment, id: "captured-video", siteDomain,
      siteUrl: siteDomain === "instagram.com" ? "https://www.instagram.com/reel/AAA/" : "https://www.tiktok.com/@creator/video/123",
      classification: { category: "social_media", productivity: "drift", source: "llm", confidence: 0.95, aiResult: true },
    };
    const reference: ActivitySegment = {
      ...video, id: "captured-reference", classification: null,
      startedAt: video.endedAt, endedAt: gameSnapshot.observedAt, durationSeconds: 60,
      siteUrl: siteDomain === "instagram.com" ? "https://www.instagram.com/referenceprofile/" : "https://www.tiktok.com/@referenceprofile",
    };
    const current = { ...gameSnapshot, siteDomain, siteUrl: reference.siteUrl };
    const input = { currentSnapshot: current, classificationOptions: {}, minimumDurationSeconds: 60 };
    expect(resolveLiveDriftAlarmAiCandidate({ ...input, segments: [video] })).toBeNull();
    expect(resolveLiveDriftAlarmAiCandidate({ ...input, segments: [video, reference] })).toMatchObject({
      sourceSegmentId: reference.id, segment: { id: reference.id, siteUrl: reference.siteUrl },
    });
  });

  it("selects the current unknown browser game for live AI classification", () => {
    const candidate = resolveLiveDriftAlarmAiCandidate({
      segments: [gameSegment],
      currentSnapshot: gameSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 60,
    });

    expect(candidate).toMatchObject({
      key: "active:survev-1",
      sourceSegmentId: "survev-1",
      segment: {
        id: "survev-1",
        durationSeconds: 462,
        siteDomain: "survev.io",
      },
    });
  });

  it("skips activity that already has a deterministic drift classification", () => {
    const candidate = resolveLiveDriftAlarmAiCandidate({
      segments: [{ ...gameSegment, id: "netflix-1", siteDomain: "netflix.com", siteTitle: "Netflix", siteUrl: "https://www.netflix.com/" }],
      currentSnapshot: { ...gameSnapshot, siteDomain: "netflix.com", siteTitle: "Netflix", siteUrl: "https://www.netflix.com/" },
      classificationOptions: {},
      minimumDurationSeconds: 60,
    });

    expect(candidate).toBeNull();
  });

  it("waits until the current unknown activity reaches the drift alarm delay", () => {
    const candidate = resolveLiveDriftAlarmAiCandidate({
      segments: [{ ...gameSegment, durationSeconds: 30, endedAt: "2026-06-15T19:22:45.000Z" }],
      currentSnapshot: gameSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 60,
    });

    expect(candidate).toBeNull();
  });
});
