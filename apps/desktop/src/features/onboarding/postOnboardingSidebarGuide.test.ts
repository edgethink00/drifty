import { describe, expect, it } from "vitest";
import {
  POST_ONBOARDING_SIDEBAR_GUIDE_LIFETIME_MS,
  POST_ONBOARDING_STORY_GUIDE_STEPS,
  advancePostOnboardingSidebarGuide,
  beginPostOnboardingSidebarGuide,
  dismissPostOnboardingSidebarGuide,
  isPostOnboardingSidebarGuideReviewEnabled,
  parsePostOnboardingSidebarGuideRecord,
  postOnboardingGuideStepInSequence,
  resolvePostOnboardingSidebarGuideRecord,
  restartPostOnboardingSidebarGuide,
  retreatPostOnboardingSidebarGuide,
} from "./postOnboardingSidebarGuide";

const NOW = new Date("2026-09-04T08:00:00.000Z");

describe("postOnboardingSidebarGuide", () => {
  it("walks welcome, day, the drift decision, activity, tracking and the handoff before completing", () => {
    const welcome = beginPostOnboardingSidebarGuide(null, NOW);
    const day = advancePostOnboardingSidebarGuide(welcome, NOW);
    const account = advancePostOnboardingSidebarGuide(day, NOW);
    const activity = advancePostOnboardingSidebarGuide(account, NOW);
    const tracking = advancePostOnboardingSidebarGuide(activity, NOW);
    const handoff = advancePostOnboardingSidebarGuide(tracking, NOW);
    const completed = advancePostOnboardingSidebarGuide(handoff, NOW);

    expect(welcome).toMatchObject({ status: "active", step: "welcome" });
    expect(day).toMatchObject({ status: "active", step: "day" });
    expect(activity).toMatchObject({ status: "active", step: "activity" });
    expect(tracking).toMatchObject({ status: "active", step: "tracking" });
    expect(account).toMatchObject({ status: "active", step: "account" });
    expect(handoff).toMatchObject({ status: "active", step: "handoff" });
    expect(completed).toMatchObject({ status: "completed", step: "handoff" });
    expect(retreatPostOnboardingSidebarGuide(handoff, NOW).step).toBe("tracking");
    expect(retreatPostOnboardingSidebarGuide(account, NOW).step).toBe("day");
    expect(retreatPostOnboardingSidebarGuide(tracking, NOW).step).toBe("activity");
    expect(retreatPostOnboardingSidebarGuide(activity, NOW).step).toBe("account");
    expect(retreatPostOnboardingSidebarGuide(day, NOW).step).toBe("welcome");
    expect(retreatPostOnboardingSidebarGuide(welcome, NOW).step).toBe("welcome");
  });

  it("opens the story sequence on the user's day and keeps a saved position across sequences", () => {
    const story = POST_ONBOARDING_STORY_GUIDE_STEPS;
    const started = beginPostOnboardingSidebarGuide(null, NOW);
    expect(postOnboardingGuideStepInSequence(started.step, story)).toBe("recap");
    const drift = advancePostOnboardingSidebarGuide(started, NOW, story);
    expect(drift.step).toBe("drift");
    expect(advancePostOnboardingSidebarGuide(drift, NOW, story).step).toBe("account");
    expect(retreatPostOnboardingSidebarGuide(drift, NOW, story).step).toBe("recap");
    // The day's data went away (or arrived) while a record was saved: same position, other card.
    expect(postOnboardingGuideStepInSequence("drift", ["welcome", "day", "account", "activity", "tracking", "handoff"])).toBe("day");
    expect(postOnboardingGuideStepInSequence("day", story)).toBe("drift");
    expect(postOnboardingGuideStepInSequence("tracking", story)).toBe("tracking");
    expect(postOnboardingGuideStepInSequence("handoff", story)).toBe("handoff");
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
