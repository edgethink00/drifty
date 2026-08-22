// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  FEATURE_NEW_BADGE_ENABLED_GRACE_MS,
  FEATURE_NEW_BADGE_MAX_ACTIVE_MS,
  FEATURE_NEW_BADGE_STORAGE_KEY,
  FEATURE_NEW_BADGE_DAY_MS,
  FEATURE_NEW_BADGE_CAMPAIGN_STARTED_AT,
  dismissFeatureNewBadge,
  isFeatureNewBadgeAudience,
  isFeatureNewBadgeVisible,
  markFeatureNewBadgeEnabled,
  rememberFeatureNewBadgeAudience,
} from "./featureNewBadges";

afterEach(() => window.localStorage.clear());

describe("feature new badges", () => {
  it("hides badges from first-run users", () => {
    rememberFeatureNewBadgeAudience(Date.parse("2026-08-22T00:00:00.000Z"));
    expect(isFeatureNewBadgeVisible("pet", { returningUser: false })).toBe(false);
  });

  it("keeps the pet badge for returning users who have not enabled it yet", () => {
    const firstSeen = Date.parse("2026-08-08T00:00:00.000Z");
    rememberFeatureNewBadgeAudience(firstSeen);
    expect(isFeatureNewBadgeVisible("pet", { returningUser: true, now: firstSeen })).toBe(true);
    dismissFeatureNewBadge("pet", firstSeen);
    expect(isFeatureNewBadgeVisible("pet", { returningUser: true, now: firstSeen })).toBe(false);
  });

  it("starts a four-day clock when the pet is turned on, instead of hiding immediately", () => {
    const firstSeen = Date.parse("2026-08-22T00:00:00.000Z");
    rememberFeatureNewBadgeAudience(firstSeen);
    const enabledAt = firstSeen + FEATURE_NEW_BADGE_DAY_MS;
    markFeatureNewBadgeEnabled("pet", enabledAt);
    expect(isFeatureNewBadgeVisible("pet", { returningUser: true, now: enabledAt })).toBe(true);
    expect(isFeatureNewBadgeVisible("pet", {
      returningUser: true,
      now: enabledAt + FEATURE_NEW_BADGE_ENABLED_GRACE_MS - 1,
    })).toBe(true);
    expect(isFeatureNewBadgeVisible("pet", {
      returningUser: true,
      now: enabledAt + FEATURE_NEW_BADGE_ENABLED_GRACE_MS,
    })).toBe(false);
  });

  it("does not restart the clock if the pet is later turned off", () => {
    const firstSeen = Date.parse("2026-08-22T00:00:00.000Z");
    rememberFeatureNewBadgeAudience(firstSeen);
    const enabledAt = firstSeen + FEATURE_NEW_BADGE_DAY_MS;
    markFeatureNewBadgeEnabled("pet", enabledAt);
    expect(isFeatureNewBadgeVisible("pet", {
      returningUser: true,
      now: enabledAt + FEATURE_NEW_BADGE_DAY_MS,
    })).toBe(true);
    expect(isFeatureNewBadgeVisible("pet", {
      returningUser: true,
      now: enabledAt + FEATURE_NEW_BADGE_ENABLED_GRACE_MS,
    })).toBe(false);
  });

  it("does not revive an unused badge after the fourteen-day cap", () => {
    const firstSeen = Date.parse("2026-08-22T00:00:00.000Z");
    rememberFeatureNewBadgeAudience(firstSeen);
    const expired = firstSeen + FEATURE_NEW_BADGE_MAX_ACTIVE_MS;
    expect(isFeatureNewBadgeVisible("pet", { returningUser: true, now: expired - 1 })).toBe(true);
    expect(isFeatureNewBadgeVisible("pet", { returningUser: true, now: expired })).toBe(false);
    markFeatureNewBadgeEnabled("pet", expired);
    expect(isFeatureNewBadgeVisible("pet", { returningUser: true, now: expired })).toBe(false);
    expect(window.localStorage.getItem(FEATURE_NEW_BADGE_STORAGE_KEY)).toContain("firstSeenAt");
  });

  it("hides the campaign from people who onboarded after it started", () => {
    expect(isFeatureNewBadgeAudience(null)).toBe(false);
    expect(isFeatureNewBadgeAudience(new Date(FEATURE_NEW_BADGE_CAMPAIGN_STARTED_AT).toISOString())).toBe(false);
    expect(isFeatureNewBadgeAudience(new Date(FEATURE_NEW_BADGE_CAMPAIGN_STARTED_AT - 1).toISOString())).toBe(true);
  });
});
