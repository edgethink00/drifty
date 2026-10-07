import { describe, expect, it } from "vitest";
import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";

import { buildDriftAlarmCandidates } from "./driftAlarmData";
import { getUnconfirmedDriftAlarmReason, resolveFreshDriftAlarmCandidate } from "./driftAlarmFreshCandidate";
import { resolveLiveDriftAlarmAiCandidate } from "./liveDriftAlarmAiCandidate";

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

  it.each([
    ["instagram.com", "https://www.instagram.com/reel/AAA/", "https://www.instagram.com/direct/inbox/"],
    ["instagram.com", "https://www.instagram.com/reel/AAA/", "https://www.instagram.com/referenceprofile/"],
    ["tiktok.com", "https://www.tiktok.com/@creator/video/123", "https://www.tiktok.com/messages"],
    ["tiktok.com", "https://www.tiktok.com/@creator/video/123", "https://www.tiktok.com/@referenceprofile"],
  ].flatMap(([siteDomain, siteUrl, nextUrl]) => (["manual", "llm"] as const).map(source => ({ siteDomain, siteUrl, nextUrl, source }))))(
    "does not carry a captured $source verdict into a different $siteDomain surface: $nextUrl", ({ siteDomain, siteUrl, nextUrl, source }) => {
      const captured: ActivitySegment = {
        ...reelSegment("classified-consumption", "2026-06-11T09:00:00.000Z", "2026-06-11T09:01:00.000Z", 60, "AAA"),
        siteDomain, siteUrl,
        classification: { category: "social_media", productivity: "drift", source, confidence: 0.95, aiResult: source === "llm" },
      };
      const current: CurrentActivitySnapshot = { ...reelSnapshot(captured.endedAt, "AAA"), siteDomain, siteUrl };
      const candidate = buildDriftAlarmCandidates({ segments: [captured], currentSnapshot: current,
        classificationOptions: {}, minimumDurationSeconds: 60 })[0]!;
      expect(candidate).toBeDefined();
      // A fresh address may arrive before the ordinary timeline poll. One
      // captured video is insufficient for the four-segment sustained rule.
      const newSurfaceInput = { segments: [captured],
        currentSnapshot: { ...current, observedAt: "2026-06-11T09:01:01.000Z", siteUrl: nextUrl },
        classificationOptions: {}, minimumDurationSeconds: 60 };
      expect(resolveFreshDriftAlarmCandidate({ ...newSurfaceInput, candidate })).toBeNull();
      // The close check must not create a live AI request for a new address
      // under the previous video's persisted record ID.
      expect(resolveLiveDriftAlarmAiCandidate(newSurfaceInput)).toBeNull();
    },
  );

  it.each(["instagram.com", "tiktok.com"])("keeps live user rules authoritative on a new %s address", siteDomain => {
    const siteUrl = siteDomain === "instagram.com" ? "https://www.instagram.com/reel/AAA/" : "https://www.tiktok.com/@creator/video/123";
    const nextUrl = siteDomain === "instagram.com" ? "https://www.instagram.com/direct/inbox/" : "https://www.tiktok.com/messages";
    const captured = { ...reelSegment("ruled-video", "2026-06-11T09:00:00.000Z", "2026-06-11T09:01:00.000Z", 60, "AAA"), siteDomain, siteUrl };
    const current = { ...reelSnapshot(captured.endedAt, "AAA"), siteDomain, siteUrl };
    const classificationOptions = { rules: [{ id: `site:${siteDomain}`, targetKind: "site" as const, targetValue: siteDomain,
      category: "social_media" as const, productivity: "drift" as const, enabled: true, confidence: 1 }] };
    const candidate = buildDriftAlarmCandidates({ segments: [captured], currentSnapshot: current,
      classificationOptions, minimumDurationSeconds: 60 })[0]!;
    const fresh = resolveFreshDriftAlarmCandidate({ candidate, segments: [captured],
      currentSnapshot: { ...current, siteUrl: nextUrl },
      classificationOptions, minimumDurationSeconds: 60 });
    expect(fresh?.classification).toMatchObject({ productivity: "drift", source: "rule" });
  });

  it.each(["instagram.com", "tiktok.com"])("keeps the sustained dwell rule on %s independent from an earlier stored verdict", siteDomain => {
    const segments = [0, 1, 2, 3].map(index => ({
      ...reelSegment(`sustained-${index}`, new Date(Date.UTC(2026, 5, 11, 9, 0, index * 20)).toISOString(),
        new Date(Date.UTC(2026, 5, 11, 9, 0, (index + 1) * 20)).toISOString(), 20, `video${index}`),
      classification: index === 3
        ? { category: "social_media" as const, productivity: "drift" as const, source: "llm" as const, confidence: 0.95, aiResult: true }
        : undefined,
      siteDomain, siteUrl: siteDomain === "instagram.com" ? `https://www.instagram.com/reel/video${index}/`
        : `https://www.tiktok.com/@creator/video/123${index}`,
    }));
    const latest = segments[segments.length - 1]!;
    const current = { ...reelSnapshot(latest.endedAt, "video3"), siteDomain, siteUrl: latest.siteUrl };
    const candidate = buildDriftAlarmCandidates({ segments, currentSnapshot: current,
      classificationOptions: {}, minimumDurationSeconds: 60 })[0]!;
    expect(candidate.classification.source).toBe("llm");
    const fresh = resolveFreshDriftAlarmCandidate({ candidate, segments,
      currentSnapshot: { ...current, siteUrl: siteDomain === "instagram.com"
        ? "https://www.instagram.com/referenceprofile/" : "https://www.tiktok.com/@referenceprofile" },
      classificationOptions: {}, minimumDurationSeconds: 60 });
    // The owner-approved four-segment rule can judge the new surface on its
    // own. Dropping a previous URL's verdict must not change that policy.
    expect(fresh).toMatchObject({ episodeKey: candidate.episodeKey,
      classification: { productivity: "drift", source: "sustained-social-dwell" } });
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
