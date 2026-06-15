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
