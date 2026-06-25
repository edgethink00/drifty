import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import { buildDriftAlarmCandidateProbe } from "./driftAlarmCandidateProbe";

const latestSegment: ActivitySegment = {
  id: "segment-1",
  startedAt: "2026-06-25T08:00:00.000Z",
  endedAt: "2026-06-25T08:05:00.000Z",
  durationSeconds: 300,
  appName: "Microsoft PowerPoint",
  bundleId: "com.microsoft.Powerpoint",
  windowTitle: "Sensitive deck title",
  browserName: null,
  siteDomain: null,
  siteUrl: null,
  platform: "macos",
  source: "accessibility",
};

const chromeSnapshot: CurrentActivitySnapshot = {
  observedAt: "2026-06-25T08:05:15.000Z",
  appName: "Google Chrome",
  bundleId: "com.google.Chrome",
  windowTitle: "Sensitive Instagram window",
  browserName: "Google Chrome",
  siteDomain: "instagram.com",
  siteUrl: "https://www.instagram.com/direct/inbox/",
  source: "accessibility",
};

describe("buildDriftAlarmCandidateProbe", () => {
  it("reports a snapshot mismatch without raw titles or URLs", () => {
    const probe = buildDriftAlarmCandidateProbe({
      segments: [latestSegment],
      currentSnapshot: chromeSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 0,
      liveAiAvailable: true,
      systemTransientActivity: null,
    });
    const serialized = JSON.stringify(probe);

    expect(probe).toMatchObject({
      reason: "current_snapshot_mismatch",
      identityMatched: false,
      latestSegment: expect.objectContaining({
        id: "segment-1",
        appName: "Microsoft PowerPoint",
        siteDomain: null,
      }),
      activeSegment: null,
    });
    expect(serialized).not.toContain("Sensitive deck title");
    expect(serialized).not.toContain("Sensitive Instagram window");
    expect(serialized).not.toContain("https://www.instagram.com");
  });

  it("reports a non-drift classification for a matched active segment", () => {
    const focusSnapshot: CurrentActivitySnapshot = {
      ...chromeSnapshot,
      appName: "Code",
      bundleId: "com.microsoft.VSCode",
      windowTitle: "Drifty",
      browserName: null,
      siteDomain: null,
      siteUrl: null,
    };
    const focusSegment: ActivitySegment = {
      ...latestSegment,
      appName: "Code",
      bundleId: "com.microsoft.VSCode",
      windowTitle: "Drifty",
      browserName: null,
      siteDomain: null,
      siteUrl: null,
    };

    const probe = buildDriftAlarmCandidateProbe({
      segments: [focusSegment],
      currentSnapshot: focusSnapshot,
      classificationOptions: {},
      minimumDurationSeconds: 0,
      liveAiAvailable: false,
      systemTransientActivity: null,
    });

    expect(probe).toMatchObject({
      reason: "classification_not_drift",
      identityMatched: true,
      classification: expect.objectContaining({
        productivity: "focus",
      }),
    });
  });
});
