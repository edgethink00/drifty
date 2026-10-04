import { describe, expect, it } from "vitest";
import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";

import { buildDriftAlarmCandidates } from "./driftAlarmData";
import { getUnconfirmedDriftAlarmReason, resolveFreshDriftAlarmCandidate } from "./driftAlarmFreshCandidate";

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

describe("getUnconfirmedDriftAlarmReason", () => {
  const segment = reelSegment("reel-a", "2026-06-11T09:00:00.000Z", "2026-06-11T09:01:00.000Z", 60, "AAA");
  const current = reelSnapshot("2026-06-11T09:01:01.000Z", "AAA");
  const input = {
    segments: [segment],
    currentSnapshot: current,
    classificationOptions: {},
    minimumDurationSeconds: 60,
  };
  const candidate = buildDriftAlarmCandidates(input)[0]!;
  const addressLost: CurrentActivitySnapshot = {
    ...current,
    siteDomain: null,
    siteUrl: null,
    siteTitle: null,
    // A readable title and the tracker's default confidence do not prove the site.
    windowTitle: current.windowTitle,
    captureConfidence: 1,
    source: "nsworkspace",
  };

  it.each([null, { ...addressLost, appName: "Unavailable", bundleId: null }, { ...addressLost, appName: " Unavailable ", bundleId: null }, { ...addressLost, appName: " " }])(
    "keeps an unreadable app unverified: %j", (snapshot) => {
      expect(getUnconfirmedDriftAlarmReason(candidate, snapshot)).toBe("current-snapshot-unavailable");
    },
  );

  it("treats an identified app named Unavailable as a verified context change", () => {
    expect(getUnconfirmedDriftAlarmReason(candidate, {
      ...addressLost, appName: "Unavailable", bundleId: "com.example.Unavailable",
      browserName: null, source: "nsworkspace",
    })).toBe("current-window-changed");
  });

  it.each(["denied", "unavailable", "stale", "empty_result"] as const)(
    "keeps an address read failure unverified with status %s", (browserAutomationStatus) => {
      const snapshot = { ...addressLost, browserAutomationStatus };
      expect(resolveFreshDriftAlarmCandidate({ ...input, candidate, currentSnapshot: snapshot })).toBeNull();
      expect(getUnconfirmedDriftAlarmReason(candidate, snapshot)).toBe("current-snapshot-unavailable");
    },
  );

  it("recognizes an address read error even without a browser status", () => {
      expect(getUnconfirmedDriftAlarmReason(candidate, { ...addressLost, browserAutomationError: "Read timed out" }))
        .toBe("current-snapshot-unavailable");
  });

  it.each(["frontmostCaptureError", "frontmostFallbackError"] as const)(
    "preserves a recovered different window despite %s", (errorField) => {
      const snapshot: CurrentActivitySnapshot = {
        ...addressLost, windowTitle: "New Tab", frontmostCaptureSource: "lsappinfo",
        [errorField]: "Primary read timed out",
      };
      expect(resolveFreshDriftAlarmCandidate({ ...input, candidate, currentSnapshot: snapshot })).toBeNull();
      expect(getUnconfirmedDriftAlarmReason(candidate, snapshot)).toBe("current-window-changed");
    },
  );

  it("uses the original browser target when the failed snapshot loses its browser name and bundle", () => {
    expect(getUnconfirmedDriftAlarmReason(candidate, {
      ...addressLost, browserName: null, bundleId: null, browserAutomationStatus: "unavailable",
    })).toBe("current-snapshot-unavailable");
  });

  it.each([
    { appName: "TextEdit", bundleId: "com.apple.TextEdit" },
    { appName: "Google Chrome", bundleId: "com.google.Chrome.canary" },
    { siteDomain: "docs.google.com", siteUrl: "https://docs.google.com/document/d/123" },
  ])("preserves suppression for an identified different target despite errors: %j", (changed) => {
    expect(getUnconfirmedDriftAlarmReason(candidate, {
      ...addressLost, browserAutomationStatus: "unavailable", browserAutomationError: "Read timed out", ...changed,
    })).toBe("current-window-changed");
  });

  it("does not label an ordinary empty browser surface as a capture failure", () => {
    expect(getUnconfirmedDriftAlarmReason(candidate, addressLost)).toBe("current-window-changed");
  });

  it("does not apply browser-address failure handling to a native app target", () => {
    expect(getUnconfirmedDriftAlarmReason({ ...candidate, segment: { ...segment, browserName: null } }, {
      ...addressLost, browserAutomationStatus: "unavailable",
    })).toBe("current-window-changed");
  });
});
