import { describe, expect, it } from "vitest";
import {
  POST_ONBOARDING_SIDEBAR_GUIDE_LIFETIME_MS,
  POST_ONBOARDING_SIDEBAR_GUIDE_STEPS,
  POST_ONBOARDING_STORY_GUIDE_STEPS,
  POST_ONBOARDING_STORY_NO_FOCUS_STEPS,
  advancePostOnboardingSidebarGuide,
  beginPostOnboardingSidebarGuide,
  dismissPostOnboardingSidebarGuide,
  isPostOnboardingSidebarGuideReviewEnabled,
  parsePostOnboardingSidebarGuideRecord,
  postOnboardingGuideStepInSequence,
  resolvePostOnboardingSidebarGuideRecord,
  restartPostOnboardingSidebarGuide,
  retreatPostOnboardingSidebarGuide,
  postOnboardingSkipPath,
  postOnboardingStorySteps,
  skipPostOnboardingSidebarGuide,
} from "./postOnboardingSidebarGuide";

const NOW = new Date("2026-09-04T08:00:00.000Z");

describe("postOnboardingSidebarGuide", () => {
  it("skips to the drift decision and the menu bar card, then ends the intro", () => {
    const welcome = beginPostOnboardingSidebarGuide(null, NOW);
    const decision = skipPostOnboardingSidebarGuide(welcome, NOW);
    expect(decision).toMatchObject({ status: "active", step: "account", skipped: true, skippedFrom: "welcome" });
    const menuBar = advancePostOnboardingSidebarGuide(decision, NOW);
    expect(menuBar).toMatchObject({ status: "active", step: "tracking", skipped: true });
    expect(advancePostOnboardingSidebarGuide(menuBar, NOW)).toMatchObject({ status: "completed", step: "tracking" });
    // Skipping again from the decision keeps the original card for Back.
    expect(skipPostOnboardingSidebarGuide(decision, NOW)).toMatchObject({ step: "tracking", skippedFrom: "welcome" });
    // Back walks the must-see cards, then returns to the card Skip was pressed on and resumes the tour.
    expect(retreatPostOnboardingSidebarGuide(menuBar, NOW)).toMatchObject({ step: "account", skipped: true });
    const back = retreatPostOnboardingSidebarGuide(decision, NOW);
    expect(back).toMatchObject({ step: "welcome", skipped: undefined, skippedFrom: undefined });
    expect([1, 2, 3].reduce((record) => advancePostOnboardingSidebarGuide(record, NOW), back).step).toBe("activity");
    // The story sequence skips the same way.
    const story = skipPostOnboardingSidebarGuide({ ...welcome, step: "drift" }, NOW, POST_ONBOARDING_STORY_GUIDE_STEPS);
    expect(story).toMatchObject({ step: "account", skippedFrom: "drift" });
    expect(retreatPostOnboardingSidebarGuide(story, NOW, POST_ONBOARDING_STORY_GUIDE_STEPS).step).toBe("drift");
    // Between the two must-see cards Skip goes to the menu bar card; after it, Skip closes as before.
    const fromActivity = skipPostOnboardingSidebarGuide({ ...welcome, step: "activity" }, NOW);
    expect(fromActivity).toMatchObject({ step: "tracking", skippedFrom: "activity" });
    expect(retreatPostOnboardingSidebarGuide(fromActivity, NOW)).toMatchObject({ step: "activity", skipped: undefined });
    expect(skipPostOnboardingSidebarGuide({ ...welcome, step: "tracking" }, NOW)).toMatchObject({ status: "dismissed" });
    expect(skipPostOnboardingSidebarGuide({ ...welcome, step: "handoff" }, NOW)).toMatchObject({ status: "dismissed" });
    expect(postOnboardingSkipPath(POST_ONBOARDING_SIDEBAR_GUIDE_STEPS, "welcome")).toEqual(["welcome", "account", "tracking"]);
    expect(postOnboardingSkipPath(POST_ONBOARDING_STORY_GUIDE_STEPS, "drift")).toEqual(["recap", "focus", "drift", "account", "tracking"]);
    expect(postOnboardingSkipPath(POST_ONBOARDING_STORY_NO_FOCUS_STEPS, "recap")).toEqual(["recap", "account", "tracking"]);
    expect(parsePostOnboardingSidebarGuideRecord(JSON.stringify(decision))).toEqual(decision);
    expect(parsePostOnboardingSidebarGuideRecord(JSON.stringify({ ...decision, skippedFrom: "nowhere" }))).toBeNull();
  });

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

  it("tells the day by kind, its focus and its drift, then the decision, the menu bar ring and the handoff", () => {
    const story = POST_ONBOARDING_STORY_GUIDE_STEPS;
    expect(story).toEqual(["recap", "focus", "drift", "account", "tracking", "handoff"]);
    // A day with almost no focus has no focus card; the story has no separate correcting card.
    expect(postOnboardingStorySteps(true)).toBe(story);
    expect(postOnboardingStorySteps(false)).toEqual(["recap", "drift", "account", "tracking", "handoff"]);
    const started = beginPostOnboardingSidebarGuide(null, NOW);
    expect(postOnboardingGuideStepInSequence(started.step, story)).toBe("recap");
    const focus = advancePostOnboardingSidebarGuide(started, NOW, story);
    expect(focus.step).toBe("focus");
    const drift = advancePostOnboardingSidebarGuide(focus, NOW, story);
    expect(advancePostOnboardingSidebarGuide(drift, NOW, story).step).toBe("account");
    expect(retreatPostOnboardingSidebarGuide(drift, NOW, story).step).toBe("focus");
    expect(advancePostOnboardingSidebarGuide(started, NOW, POST_ONBOARDING_STORY_NO_FOCUS_STEPS).step).toBe("drift");
  });

  it("keeps a saved position across sequences, and moves a saved correcting card on to the menu bar ring", () => {
    const story = POST_ONBOARDING_STORY_GUIDE_STEPS;
    // The day's data went away (or arrived) while a record was saved: same position among the day's cards.
    expect(postOnboardingGuideStepInSequence("drift", POST_ONBOARDING_SIDEBAR_GUIDE_STEPS)).toBe("day");
    expect(postOnboardingGuideStepInSequence("focus", POST_ONBOARDING_SIDEBAR_GUIDE_STEPS)).toBe("day");
    expect(postOnboardingGuideStepInSequence("day", story)).toBe("focus");
    expect(postOnboardingGuideStepInSequence("day", POST_ONBOARDING_STORY_NO_FOCUS_STEPS)).toBe("drift");
    expect(postOnboardingGuideStepInSequence("focus", POST_ONBOARDING_STORY_NO_FOCUS_STEPS)).toBe("drift");
    expect(postOnboardingGuideStepInSequence("tracking", story)).toBe("tracking");
    expect(postOnboardingGuideStepInSequence("handoff", story)).toBe("handoff");
    // A record saved on the correcting card by an earlier story resumes on the next card the story has.
    expect(postOnboardingGuideStepInSequence("activity", story)).toBe("tracking");
    const saved = { ...beginPostOnboardingSidebarGuide(null, NOW), step: "activity" as const };
    expect(advancePostOnboardingSidebarGuide(saved, NOW, story).step).toBe("handoff");
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
