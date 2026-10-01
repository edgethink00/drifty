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
  it("walks welcome, day, activity, account, and tracking before completing", () => {
    const welcome = beginPostOnboardingSidebarGuide(null, NOW);
    const day = advancePostOnboardingSidebarGuide(welcome, NOW);
    const activity = advancePostOnboardingSidebarGuide(day, NOW);
    const account = advancePostOnboardingSidebarGuide(activity, NOW);
    const tracking = advancePostOnboardingSidebarGuide(account, NOW);
    const completed = advancePostOnboardingSidebarGuide(tracking, NOW);

    expect(welcome).toMatchObject({ status: "active", step: "welcome" });
    expect(day).toMatchObject({ status: "active", step: "day" });
    expect(activity).toMatchObject({ status: "active", step: "activity" });
    expect(tracking).toMatchObject({ status: "active", step: "tracking" });
    expect(account).toMatchObject({ status: "active", step: "account" });
    expect(completed).toMatchObject({ status: "completed", step: "tracking" });
    expect(retreatPostOnboardingSidebarGuide(account, NOW).step).toBe("activity");
    expect(retreatPostOnboardingSidebarGuide(tracking, NOW).step).toBe("account");
    expect(retreatPostOnboardingSidebarGuide(activity, NOW).step).toBe("day");
    expect(retreatPostOnboardingSidebarGuide(day, NOW).step).toBe("welcome");
    expect(retreatPostOnboardingSidebarGuide(welcome, NOW).step).toBe("welcome");
  });

  it("resumes a guide saved on the retired dashboard step at the day introduction", () => {
    expect(parsePostOnboardingSidebarGuideRecord(JSON.stringify({
      version: 1,
      status: "active",
      step: "dashboard",
      startedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    }))).toMatchObject({ status: "active", step: "day" });
  });

  it("does not reopen a guide the user already completed or dismissed", () => {
    const active = beginPostOnboardingSidebarGuide(null, NOW);
    const dismissed = dismissPostOnboardingSidebarGuide(active, NOW);

    expect(beginPostOnboardingSidebarGuide(dismissed, NOW)).toBe(dismissed);
    const completed = { ...active, status: "completed" as const };
    expect(beginPostOnboardingSidebarGuide(completed, NOW)).toBe(completed);
    expect(restartPostOnboardingSidebarGuide(NOW)).toMatchObject({ status: "active", step: "welcome" });
  });

  it("preserves an existing active menu step when the intro changes", () => {
    for (const step of ["activity", "tracking", "account"]) {
      const record = parsePostOnboardingSidebarGuideRecord(JSON.stringify({
        version: 1, status: "active", step, startedAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
      }));
      expect(beginPostOnboardingSidebarGuide(record, NOW).step).toBe(step);
    }
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
