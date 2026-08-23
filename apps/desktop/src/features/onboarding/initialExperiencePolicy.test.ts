import { describe, expect, it } from "vitest";

import {
  INITIAL_DAILY_FOCUS_QUIET_PERIOD_MS,
  isInitialDailyFocusQuietPeriod,
  isInstallDayReviewEligible,
} from "./initialExperiencePolicy";

describe("initial experience policy", () => {
  describe("install-day review eligibility", () => {
    it("allows an install completed before 3:30 PM local time", () => {
      expect(isInstallDayReviewEligible(
        new Date(2026, 7, 23, 15, 29, 59).toISOString(),
        "2026-08-23",
      )).toBe(true);
    });

    it("excludes 3:30 PM exactly and every later install from that day's review", () => {
      expect(isInstallDayReviewEligible(
        new Date(2026, 7, 23, 15, 30, 0).toISOString(),
        "2026-08-23",
      )).toBe(false);
      expect(isInstallDayReviewEligible(
        new Date(2026, 7, 23, 21, 0, 0).toISOString(),
        "2026-08-23",
      )).toBe(false);
    });

    it("does not affect later review days or legacy records without a timestamp", () => {
      const completedAt = new Date(2026, 7, 23, 21, 0, 0).toISOString();
      expect(isInstallDayReviewEligible(completedAt, "2026-08-24")).toBe(true);
      expect(isInstallDayReviewEligible(null, "2026-08-23")).toBe(true);
      expect(isInstallDayReviewEligible("not-a-date", "2026-08-23")).toBe(true);
    });

    it("uses the logical day so a 3 AM install belongs to the previous review day", () => {
      const completedAt = new Date(2026, 7, 24, 3, 0, 0).toISOString();
      // 3 AM is still the previous logical day when the day starts at 4 AM.
      // The 3:30 PM cutoff is clock time, so 3 AM remains eligible for that
      // previous day and does not suppress the next logical day's review.
      expect(isInstallDayReviewEligible(completedAt, "2026-08-23", 4 * 60)).toBe(true);
      expect(isInstallDayReviewEligible(completedAt, "2026-08-24", 4 * 60)).toBe(true);
    });

    it("withholds a late clock-time install from the matching logical day across a late start of day", () => {
      const completedAt = new Date(2026, 7, 23, 20, 10, 0).toISOString();
      expect(isInstallDayReviewEligible(completedAt, "2026-08-22", 21 * 60)).toBe(false);
      expect(isInstallDayReviewEligible(completedAt, "2026-08-23", 21 * 60)).toBe(true);
    });
  });

  describe("daily focus quiet period", () => {
    const completedAt = "2026-08-23T01:00:00.000Z";
    const completedAtMs = Date.parse(completedAt);

    it("keeps daily focus announcements quiet for the first 15 minutes", () => {
      expect(isInitialDailyFocusQuietPeriod(completedAt, completedAtMs)).toBe(true);
      expect(isInitialDailyFocusQuietPeriod(
        completedAt,
        completedAtMs + INITIAL_DAILY_FOCUS_QUIET_PERIOD_MS - 1,
      )).toBe(true);
    });

    it("ends the quiet period at the boundary", () => {
      expect(isInitialDailyFocusQuietPeriod(
        completedAt,
        completedAtMs + INITIAL_DAILY_FOCUS_QUIET_PERIOD_MS,
      )).toBe(false);
    });

    it("does not suppress on missing, invalid, or future completion timestamps", () => {
      expect(isInitialDailyFocusQuietPeriod(null, completedAtMs)).toBe(false);
      expect(isInitialDailyFocusQuietPeriod("not-a-date", completedAtMs)).toBe(false);
      expect(isInitialDailyFocusQuietPeriod(completedAt, completedAtMs - 1)).toBe(false);
    });
  });
});
