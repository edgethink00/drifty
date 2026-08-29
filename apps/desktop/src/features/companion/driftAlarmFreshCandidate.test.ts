import { describe, expect, it } from "vitest";
import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";

import { buildDriftAlarmCandidates } from "./driftAlarmData";
import { resolveFreshDriftAlarmCandidate } from "./driftAlarmFreshCandidate";

function reelSegment(
  id: string,
  startedAt: string,
  endedAt: string,
  durationSeconds: number,
  reelId: string,
): ActivitySegment {
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds,
    appName: "Google Chrome",
    bundleId: "com.google.Chrome",
    windowTitle: `Instagram Reel ${reelId}`,
    browserName: "Google Chrome",
    siteDomain: "instagram.com",
    siteTitle: `Instagram Reel ${reelId}`,
    siteUrl: `https://www.instagram.com/reel/${reelId}/`,
    platform: "macos",
    source: "nsworkspace",
  };
}

function reelSnapshot(observedAt: string, reelId: string): CurrentActivitySnapshot {
  return {
    observedAt,
    appName: "Google Chrome",
    bundleId: "com.google.Chrome",
    windowTitle: `Instagram Reel ${reelId}`,
    browserName: "Google Chrome",
    siteDomain: "instagram.com",
    siteTitle: `Instagram Reel ${reelId}`,
    siteUrl: `https://www.instagram.com/reel/${reelId}/`,
    source: "accessibility",
  };
}

describe("resolveFreshDriftAlarmCandidate", () => {
  it("keeps the episode but refreshes the current Reel target before delivery", () => {
    const firstReel = reelSegment(
      "reel-a",
      "2026-06-11T09:00:00.000Z",
      "2026-06-11T09:00:25.000Z",
      25,
      "AAA",
    );
    const currentReel = reelSegment(
      "reel-b",
      "2026-06-11T09:00:30.000Z",
      "2026-06-11T09:00:55.000Z",
      25,
      "BBB",
    );
    const segments = [firstReel, currentReel];
    const candidate = buildDriftAlarmCandidates({
      segments,
      currentSnapshot: reelSnapshot("2026-06-11T09:01:05.000Z", "BBB"),
      classificationOptions: {},
      minimumDurationSeconds: 60,
    })[0]!;

    const freshCandidate = resolveFreshDriftAlarmCandidate({
      candidate,
      segments,
      currentSnapshot: reelSnapshot("2026-06-11T09:01:06.000Z", "CCC"),
      classificationOptions: {},
      minimumDurationSeconds: 60,
    });

    expect(freshCandidate).toMatchObject({
      episodeKey: "drift-episode:reel-a",
      sourceSegmentId: "reel-b",
      segment: {
        id: "reel-b",
        siteTitle: "Instagram Reel CCC",
        siteUrl: "https://www.instagram.com/reel/CCC/",
      },
    });
  });

  it("fails closed after the current window leaves the episode surface", () => {
    const currentReel = reelSegment(
      "reel-a",
      "2026-06-11T09:00:00.000Z",
      "2026-06-11T09:01:00.000Z",
      60,
      "AAA",
    );
    const segments = [currentReel];
    const candidate = buildDriftAlarmCandidates({
      segments,
      currentSnapshot: reelSnapshot("2026-06-11T09:01:00.000Z", "AAA"),
      classificationOptions: {},
      minimumDurationSeconds: 60,
    })[0]!;

    expect(resolveFreshDriftAlarmCandidate({
      candidate,
      segments,
      currentSnapshot: {
        ...reelSnapshot("2026-06-11T09:01:01.000Z", "AAA"),
        siteDomain: "docs.google.com",
        siteTitle: "Project notes",
        siteUrl: "https://docs.google.com/document/d/123",
        windowTitle: "Project notes",
      },
      classificationOptions: {},
      minimumDurationSeconds: 60,
    })).toBeNull();
  });
});
