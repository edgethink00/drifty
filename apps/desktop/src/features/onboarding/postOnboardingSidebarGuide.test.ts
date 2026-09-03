import { describe, expect, it } from "vitest";
import {
  POST_ONBOARDING_SIDEBAR_GUIDE_LIFETIME_MS,
  advancePostOnboardingSidebarGuide,
  beginPostOnboardingSidebarGuide,
  dismissPostOnboardingSidebarGuide,
  isPostOnboardingSidebarGuideReviewEnabled,
  parsePostOnboardingSidebarGuideRecord,
  resolvePostOnboardingSidebarGuideRecord,
  restartPostOnboardingSidebarGuide,
  retreatPostOnboardingSidebarGuide,
} from "./postOnboardingSidebarGuide";

const NOW = new Date("2026-09-04T08:00:00.000Z");

describe("postOnboardingSidebarGuide", () => {
  it("walks dashboard, activity, tracking, and account before completing", () => {
    const dashboard = beginPostOnboardingSidebarGuide(null, NOW);
    const activity = advancePostOnboardingSidebarGuide(dashboard, NOW);
    const tracking = advancePostOnboardingSidebarGuide(activity, NOW);
    const account = advancePostOnboardingSidebarGuide(tracking, NOW);
    const completed = advancePostOnboardingSidebarGuide(account, NOW);

    expect(dashboard).toMatchObject({ status: "active", step: "dashboard" });
    expect(activity).toMatchObject({ status: "active", step: "activity" });
    expect(tracking).toMatchObject({ status: "active", step: "tracking" });
    expect(account).toMatchObject({ status: "active", step: "account" });
    expect(completed).toMatchObject({ status: "completed", step: "account" });
    expect(retreatPostOnboardingSidebarGuide(tracking, NOW).step).toBe("activity");
    expect(retreatPostOnboardingSidebarGuide(account, NOW).step).toBe("tracking");
  });

  it("does not reopen a guide the user already completed or dismissed", () => {
    const active = beginPostOnboardingSidebarGuide(null, NOW);
    const dismissed = dismissPostOnboardingSidebarGuide(active, NOW);

    expect(beginPostOnboardingSidebarGuide(dismissed, NOW)).toBe(dismissed);
    expect(restartPostOnboardingSidebarGuide(NOW)).toMatchObject({ status: "active", step: "dashboard" });
  });

  it("expires an abandoned active guide after seven days", () => {
    const active = beginPostOnboardingSidebarGuide(null, NOW);
    const later = new Date(NOW.getTime() + POST_ONBOARDING_SIDEBAR_GUIDE_LIFETIME_MS + 1);

    expect(resolvePostOnboardingSidebarGuideRecord(active, later)?.status).toBe("expired");
  });

  it("rejects malformed storage and keeps review mode development-only", () => {
    expect(parsePostOnboardingSidebarGuideRecord("not-json")).toBeNull();
    expect(parsePostOnboardingSidebarGuideRecord(JSON.stringify({ version: 1, status: "active" }))).toBeNull();
    expect(isPostOnboardingSidebarGuideReviewEnabled("?driftySidebarGuideReview=1", true)).toBe(true);
    expect(isPostOnboardingSidebarGuideReviewEnabled("?driftySidebarGuideReview=1", false)).toBe(false);
  });
});
