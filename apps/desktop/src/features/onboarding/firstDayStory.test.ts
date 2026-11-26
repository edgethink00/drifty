import { describe, expect, it } from "vitest";
import { buildFirstDayRecap, refineIntroDecisionReason, resolveFirstDayRecap } from "./firstDayStory";
import { buildFirstDayReviewSegments, buildIntroReviewCase } from "./introStoryReview";
import { sanitizePostHogEventProperties } from "../../lib/analytics/events";

const DAY = "2026-09-30";
const TODAY = "2026-10-01";

describe("tutorial story", () => {
  it("reports the actual first matching intro decision without changing recap eligibility", () => {
    const input = { segments: buildFirstDayReviewSegments(DAY), day: DAY, today: TODAY };
    expect(resolveFirstDayRecap(input)).toEqual({ recap: buildFirstDayRecap(input), decisionReason: "story_ready" });
    expect(resolveFirstDayRecap({ ...input, segments: buildFirstDayReviewSegments(TODAY), day: TODAY }).decisionReason).toBe("story_ready");
    expect(resolveFirstDayRecap({ ...input, day: "2026-09-28" }).decisionReason).toBe("prepared_other_day");
    expect(resolveFirstDayRecap({ ...input, segments: [] }).decisionReason).toBe("no_usable_history");
    const short = buildFirstDayReviewSegments(DAY, 2);
    expect(resolveFirstDayRecap({ ...input, segments: short }).decisionReason).toBe("below_classified_minimum");
    const noFocus = input.segments.map(segment => ({ ...segment, classification: { ...segment.classification!, productivity: "neutral" as const } }));
    expect(resolveFirstDayRecap({ ...input, segments: noFocus }).decisionReason).toBe("story_no_focus");
  });

  it("labels why a sample intro was shown from what preparation saw, and leaves other reasons alone", () => {
    const facts = { importEnabled: true, safariLocked: false, windowRecordedSeconds: 20 * 60 };
    expect(refineIntroDecisionReason("no_usable_history", { ...facts, importEnabled: false })).toBe("no_history_import_off");
    expect(refineIntroDecisionReason("no_usable_history", { ...facts, safariLocked: true })).toBe("no_history_safari_locked");
    expect(refineIntroDecisionReason("no_usable_history", facts)).toBe("no_usable_history");
    // The three imported days together held 40 minutes: a story over the whole window could have opened.
    expect(refineIntroDecisionReason("below_classified_minimum", { ...facts, windowRecordedSeconds: 40 * 60 })).toBe("below_classified_window_enough");
    expect(refineIntroDecisionReason("below_classified_minimum", facts)).toBe("below_classified_minimum");
    expect(refineIntroDecisionReason("below_classified_minimum", { ...facts, windowRecordedSeconds: null })).toBe("below_classified_minimum");
    expect(refineIntroDecisionReason("story_ready", { ...facts, importEnabled: false })).toBe("story_ready");
    expect(refineIntroDecisionReason("no_usable_history", null)).toBe("no_usable_history");
  });

  it("only allows fixed decision labels and strips underlying history, dates and errors", () => {
    const properties = { action: "step_viewed", step: "recap", sequence: "story", decision_reason: "story_ready", story_day: "today", selected_day: DAY, focus_seconds: 1800, window_title: "Private work", error: "Private path" };
    expect(sanitizePostHogEventProperties("onboarding_intro", properties)).toEqual({
      action: "step_viewed", step: "recap", sequence: "story", decision_reason: "story_ready", story_day: "today",
    });
    expect(sanitizePostHogEventProperties("onboarding_intro", { decision_reason: "Private work", story_day: DAY })).toEqual({});
    for (const reason of ["story_no_focus", "no_history_import_off", "no_history_safari_locked", "below_classified_window_enough"]) {
      expect(sanitizePostHogEventProperties("onboarding_intro", { decision_reason: reason })).toEqual({ decision_reason: reason });
    }
  });

  it("tells the longest focus stretch and the largest drift source of the day", () => {
    const recap = buildFirstDayRecap({ segments: buildFirstDayReviewSegments(DAY), day: DAY, today: TODAY });
    expect(recap).not.toBeNull();
    expect(recap?.importedOnly).toBe(true);
    // 14:02-15:06 on GitHub with a short Stack Overflow lookup inside it.
    expect(recap?.longestFocus?.source.label).toBe("github.com");
    expect(recap?.longestFocus?.seconds).toBe(64 * 60);
    expect(recap?.topDrift).toMatchObject({ seconds: 72 * 60, source: { label: "youtube.com" } });
    expect(recap?.firstHour).toBe(9);
    expect(recap?.hourCount).toBe(13);
  });

  it("tells yesterday, today so far or the whole imported day before, and keeps the sample cards for older days", () => {
    expect(buildFirstDayRecap({ segments: buildFirstDayReviewSegments(DAY), day: DAY, today: TODAY })?.dayRelation).toBe("yesterday");
    // Yesterday was too thin, so preparation took today: the same story, with the same minimums.
    expect(buildFirstDayRecap({ segments: buildFirstDayReviewSegments(TODAY), day: TODAY, today: TODAY })?.dayRelation).toBe("today");
    // The 72-hour import covers the day before yesterday whole.
    expect(buildFirstDayRecap({ segments: buildFirstDayReviewSegments("2026-09-29"), day: "2026-09-29", today: TODAY })?.dayRelation).toBe("dayBefore");
    expect(resolveFirstDayRecap({ segments: buildFirstDayReviewSegments("2026-09-28"), day: "2026-09-28", today: TODAY }).decisionReason).toBe("prepared_other_day");
    expect(resolveFirstDayRecap({ segments: buildFirstDayReviewSegments(TODAY, 2), day: TODAY, today: TODAY }).decisionReason).toBe("below_classified_minimum");
  });

  it("opens on focus from 30 minutes, on the time it read from 5, and on where the time went below that", () => {
    const segments = buildFirstDayReviewSegments(DAY).map((segment) => segment.classification?.productivity === "focus" && segment.siteDomain !== "docs.google.com"
      ? { ...segment, classification: { ...segment.classification, productivity: "neutral" as const } } : segment);
    // Only docs.google.com stays focus: 22 + 28 = 50 minutes, enough.
    expect(buildFirstDayRecap({ segments, day: DAY, today: TODAY })).toMatchObject({ focusSeconds: 50 * 60, lead: "focus" });
    const thin = segments.map((segment) => segment.siteTitle === "Launch checklist"
      ? { ...segment, classification: { ...segment.classification!, productivity: "neutral" as const } } : segment);
    // 22 minutes of focus is not enough to lead with, so the story opens on the classified time instead.
    const thinStory = resolveFirstDayRecap({ segments: thin, day: DAY, today: TODAY });
    expect(thinStory.decisionReason).toBe("story_low_focus");
    expect(thinStory.recap).toMatchObject({ lead: "overview", focusSeconds: 22 * 60, longestFocus: { seconds: 22 * 60, source: { label: "docs.google.com" } } });
    const trace = thin.map((segment) => segment.siteTitle === "Q4 planning"
      ? { ...segment, durationSeconds: 4 * 60, endedAt: new Date(Date.parse(segment.startedAt) + 4 * 60_000).toISOString() } : segment);
    // 4 minutes of focus has no stretch worth naming: the story names the three places with the most time.
    const traceStory = resolveFirstDayRecap({ segments: trace, day: DAY, today: TODAY });
    expect(traceStory.decisionReason).toBe("story_no_focus");
    expect(traceStory.recap).toMatchObject({ lead: "sources", focusSeconds: 4 * 60 });
    expect(traceStory.recap?.topSources.map((entry) => [entry.source.label, entry.seconds / 60])).toEqual([
      ["github.com", 125], ["youtube.com", 72], ["figma.com", 59],
    ]);
  });

  it("still keeps the sample cards when too little of the day is classified, whatever its focus", () => {
    const segments = buildFirstDayReviewSegments(DAY, 2).map((segment) => segment.classification?.productivity === "focus"
      ? { ...segment, classification: { ...segment.classification, productivity: "neutral" as const } } : segment);
    expect(resolveFirstDayRecap({ segments, day: DAY, today: TODAY }).decisionReason).toBe("below_classified_minimum");
  });

  it("returns no recap while too little of the day is classified", () => {
    const fewClassified = buildFirstDayReviewSegments(DAY, 2);
    expect(buildFirstDayRecap({ segments: fewClassified, day: DAY, today: TODAY })).toBeNull();
    expect(buildFirstDayRecap({ segments: [], day: DAY, today: TODAY })).toBeNull();
  });

  it("keeps a drift site for the Automatic close preview when the top drift is an app or too small to name", () => {
    const appDrift = buildIntroReviewCase("appDrift", () => DAY);
    const appRecap = buildFirstDayRecap({ segments: appDrift.segments, day: DAY, today: TODAY });
    expect(appRecap?.topDrift?.source).toMatchObject({ kind: "app", label: "Steam" });
    expect(appRecap?.topDriftSite).toMatchObject({ kind: "site" });
    expect(appRecap?.topDriftSite?.label).not.toBe("Steam");

    const lowDrift = buildIntroReviewCase("lowDrift", () => DAY);
    const lowRecap = buildFirstDayRecap({ segments: lowDrift.segments, day: DAY, today: TODAY });
    expect(lowRecap?.topDrift).toBeNull();
    expect(lowRecap?.topDriftSite?.label).toBe("youtube.com");

    const noDrift = buildIntroReviewCase("noDrift", () => DAY);
    expect(buildFirstDayRecap({ segments: noDrift.segments, day: DAY, today: TODAY })?.topDriftSite).toBeNull();
  });
});
