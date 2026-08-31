import { describe, expect, it } from "vitest";
import {
  classifyActivityDetailed,
  classifySocialActivity,
  isSustainedSocialHomeFeed,
  isUnresolvedSocialSurface,
  resolveSocialSurface,
  SOCIAL_FEED_DRIFT_MINIMUM_SECONDS,
} from "@drifty/domain";
import type { ActivitySegment } from "@drifty/domain";

function socialSegment(overrides: Partial<ActivitySegment> & Pick<ActivitySegment, "siteDomain">): ActivitySegment {
  return {
    id: "seg-social",
    startedAt: "2026-08-31T09:00:00.000Z",
    endedAt: "2026-08-31T09:05:00.000Z",
    durationSeconds: 300,
    appName: "Safari",
    bundleId: "com.apple.Safari",
    browserName: "Safari",
    platform: "macos",
    source: "nsworkspace",
    ...overrides,
  };
}

describe("resolveSocialSurface", () => {
  it("separates consumption, purposeful, home, and other surfaces per site", () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ["instagram.com", "https://www.instagram.com/reels/AAA/", "consumption"],
      ["instagram.com", "https://www.instagram.com/explore/", "consumption"],
      ["instagram.com", "https://www.instagram.com/direct/t/123", "purposeful"],
      ["instagram.com", "https://www.instagram.com/", "home_feed"],
      ["instagram.com", "https://www.instagram.com/someprofile/", "other"],
      ["x.com", "https://x.com/home", "home_feed"],
      ["x.com", "https://x.com/explore", "consumption"],
      ["x.com", "https://x.com/messages/9", "purposeful"],
      ["x.com", "https://x.com/someuser", "other"],
      ["twitter.com", "https://twitter.com/notifications", "purposeful"],
    ];

    for (const [siteDomain, siteUrl, expected] of cases) {
      expect(resolveSocialSurface(socialSegment({ siteDomain, siteUrl }))?.kind, `${siteUrl}`).toBe(expected);
    }
  });

  it("returns null for non-social hosts and stays 'other' when the path was never captured", () => {
    expect(resolveSocialSurface(socialSegment({ siteDomain: "github.com", siteUrl: "https://github.com/x" }))).toBeNull();
    expect(resolveSocialSurface(socialSegment({ siteDomain: "instagram.com", siteUrl: null }))?.kind).toBe("other");
  });
});

describe("isSustainedSocialHomeFeed", () => {
  it("only counts the home feed once the user has settled into it", () => {
    const brief = socialSegment({
      siteDomain: "x.com",
      siteUrl: "https://x.com/home",
      durationSeconds: SOCIAL_FEED_DRIFT_MINIMUM_SECONDS - 1,
    });
    const settled = socialSegment({
      siteDomain: "x.com",
      siteUrl: "https://x.com/home",
      durationSeconds: SOCIAL_FEED_DRIFT_MINIMUM_SECONDS,
    });

    expect(isSustainedSocialHomeFeed(brief)).toBe(false);
    expect(isSustainedSocialHomeFeed(settled)).toBe(true);
  });
});

describe("classifySocialActivity", () => {
  it("resolves consumption surfaces to drift on their own", () => {
    expect(classifySocialActivity(socialSegment({
      siteDomain: "instagram.com",
      siteUrl: "https://www.instagram.com/reels/AAA/",
    }))).toEqual({ category: "social_media", productivity: "drift" });
  });

  it("leaves DMs and specific profiles unjudged instead of calling them drift", () => {
    for (const siteUrl of ["https://www.instagram.com/direct/t/1", "https://www.instagram.com/someprofile/", "https://x.com/someuser"]) {
      const siteDomain = siteUrl.includes("instagram") ? "instagram.com" : "x.com";
      expect(classifySocialActivity(socialSegment({ siteDomain, siteUrl })), siteUrl)
        .toEqual({ category: "unknown", productivity: "neutral" });
    }
  });
});

describe("isUnresolvedSocialSurface", () => {
  it("marks exactly the surfaces that still need an AI verdict", () => {
    const profile = socialSegment({ siteDomain: "x.com", siteUrl: "https://x.com/someuser" });
    const reels = socialSegment({ siteDomain: "instagram.com", siteUrl: "https://www.instagram.com/reels/AAA/" });
    const settledHome = socialSegment({ siteDomain: "x.com", siteUrl: "https://x.com/home", durationSeconds: 600 });

    expect(isUnresolvedSocialSurface(profile)).toBe(true);
    expect(isUnresolvedSocialSurface(reels)).toBe(false);
    expect(isUnresolvedSocialSurface(settledHome)).toBe(false);
  });
});

describe("classifyActivityDetailed on social hosts", () => {
  it("no longer calls a profile visit drift from the domain alone", () => {
    const profile = classifyActivityDetailed(socialSegment({
      siteDomain: "instagram.com",
      siteUrl: "https://www.instagram.com/someprofile/",
      siteTitle: "Some Profile",
    }), { includeAiClassifications: false });

    expect(profile.productivity).toBe("neutral");
    expect(profile.category).toBe("unknown");
  });

  it("still calls reels and a settled home feed drift", () => {
    const reels = classifyActivityDetailed(socialSegment({
      siteDomain: "instagram.com",
      siteUrl: "https://www.instagram.com/reels/AAA/",
    }), { includeAiClassifications: false });
    const home = classifyActivityDetailed(socialSegment({
      siteDomain: "x.com",
      siteUrl: "https://x.com/home",
      durationSeconds: 600,
    }), { includeAiClassifications: false });

    expect(reels.productivity).toBe("drift");
    expect(home.productivity).toBe("drift");
  });
});
