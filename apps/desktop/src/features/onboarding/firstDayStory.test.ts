import { describe, expect, it, vi } from "vitest";
import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";
import { shiftIsoDate } from "@drifty/domain";
import { buildFirstDayRecap, firstDayStoryReadyNow, refineIntroDecisionReason, resolveFirstDayRecap, resolveFirstDayStory, storyHasFocusCard, storyTitle } from "./firstDayStory";
import { firstDaySourceOf } from "./firstDayPreparationStory";
import { buildFirstDayReviewSegments, buildIntroReviewCase } from "./introStoryReview";
import { sanitizePostHogEventProperties } from "../../lib/analytics/events";

const DAY = "2026-09-30";
const TODAY = "2026-10-01";

type Visit = readonly [hour: number, minute: number, seconds: number, domain: string, title: string, category: ActivityCategory, productivity: ProductivityLabel];

/** Imported browser visits on DAY, each already classified. */
function visits(entries: readonly Visit[]): ActivitySegment[] {
  return entries.map(([hour, minute, seconds, domain, title, category, productivity], index) => {
    const startedAt = new Date(DAY + "T" + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") + ":00");
    return {
      id: "visit-" + index,
      startedAt: startedAt.toISOString(),
      endedAt: new Date(startedAt.getTime() + seconds * 1000).toISOString(),
      durationSeconds: seconds,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      siteDomain: domain,
      siteTitle: title,
      siteUrl: "https://" + domain + "/",
      windowTitle: title,
      platform: "macos",
      source: "browser-history-import",
      siteSource: "browser-history-import",
      classification: { category, productivity, source: "llm", confidence: 0.9, aiResult: true, reason: "" },
    } as ActivitySegment;
  });
}

describe("tutorial story", () => {
  it("reports the actual first matching intro decision without changing recap eligibility", () => {
    const input = { segments: buildFirstDayReviewSegments(DAY), day: DAY, today: TODAY };
    expect(resolveFirstDayRecap(input)).toEqual({ recap: buildFirstDayRecap(input), decisionReason: "story_ready" });
    expect(resolveFirstDayRecap({ ...input, segments: buildFirstDayReviewSegments(TODAY), day: TODAY }).decisionReason).toBe("story_ready");
    expect(resolveFirstDayRecap({ ...input, day: "2026-09-28" }).decisionReason).toBe("prepared_other_day");
    expect(resolveFirstDayRecap({ ...input, segments: [] }).decisionReason).toBe("no_usable_history");
    // One visit classified out of a full day: enough time recorded, too little of it sorted yet.
    const unsorted = buildFirstDayReviewSegments(DAY, 1);
    expect(resolveFirstDayRecap({ ...input, segments: unsorted }).decisionReason).toBe("below_classified_unsorted");
    const thin = unsorted.filter((segment) => segment.classification?.category !== "unknown");
    expect(resolveFirstDayRecap({ ...input, segments: thin }).decisionReason).toBe("below_classified_minimum");
    const noFocus = input.segments.map(segment => ({ ...segment, classification: { ...segment.classification!, productivity: "neutral" as const } }));
    expect(resolveFirstDayRecap({ ...input, segments: noFocus }).decisionReason).toBe("story_no_focus");
  });

  it("labels why a sample intro was shown from what preparation saw, and leaves other reasons alone", () => {
    const facts = { importEnabled: true, safariLocked: false, windowRecordedSeconds: 10 * 60 };
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
    for (const reason of ["story_no_focus", "no_history_import_off", "no_history_safari_locked", "below_classified_window_enough", "below_classified_unsorted"]) {
      expect(sanitizePostHogEventProperties("onboarding_intro", { decision_reason: reason })).toEqual({ decision_reason: reason });
    }
    expect(sanitizePostHogEventProperties("onboarding_intro", { story_day: "recent_days" })).toEqual({ story_day: "recent_days" });
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
    const thinToday = buildFirstDayReviewSegments(TODAY, 1).filter((segment) => segment.classification?.category !== "unknown");
    expect(resolveFirstDayRecap({ segments: thinToday, day: TODAY, today: TODAY }).decisionReason).toBe("below_classified_minimum");
  });

  it("has a focus card from 5 minutes of focus, labelled by 30 minutes, and none below 5", () => {
    const segments = buildFirstDayReviewSegments(DAY).map((segment) => segment.classification?.productivity === "focus" && segment.siteDomain !== "docs.google.com"
      ? { ...segment, classification: { ...segment.classification, productivity: "neutral" as const } } : segment);
    // Only docs.google.com stays focus: 22 + 28 = 50 minutes, enough.
    const full = buildFirstDayRecap({ segments, day: DAY, today: TODAY })!;
    expect(full).toMatchObject({ focusSeconds: 50 * 60, lead: "focus" });
    expect(storyHasFocusCard(full)).toBe(true);
    const thin = segments.map((segment) => segment.siteTitle === "Launch checklist"
      ? { ...segment, classification: { ...segment.classification!, productivity: "neutral" as const } } : segment);
    // 22 minutes of focus still gets its card, under its own label.
    const thinStory = resolveFirstDayRecap({ segments: thin, day: DAY, today: TODAY });
    expect(thinStory.decisionReason).toBe("story_low_focus");
    expect(thinStory.recap).toMatchObject({ lead: "overview", focusSeconds: 22 * 60, longestFocus: { seconds: 22 * 60, source: { label: "docs.google.com" } } });
    expect(storyHasFocusCard(thinStory.recap!)).toBe(true);
    const trace = thin.map((segment) => segment.siteTitle === "Q4 planning"
      ? { ...segment, durationSeconds: 4 * 60, endedAt: new Date(Date.parse(segment.startedAt) + 4 * 60_000).toISOString() } : segment);
    // 4 minutes of focus has no stretch worth naming: the story goes from the day by kind to the drift.
    const traceStory = resolveFirstDayRecap({ segments: trace, day: DAY, today: TODAY });
    expect(traceStory.decisionReason).toBe("story_no_focus");
    expect(traceStory.recap).toMatchObject({ lead: "kinds", focusSeconds: 4 * 60 });
    expect(storyHasFocusCard(traceStory.recap!)).toBe(false);
    expect(traceStory.recap?.categories.slice(0, 3).map((entry) => [entry.category, entry.seconds / 60])).toEqual([
      ["workspace", 259], ["entertainment", 86], ["communication", 39],
    ]);
  });

  it("sorts a day off by kind", () => {
    const recap = buildFirstDayRecap({ ...buildIntroReviewCase("noFocus", () => DAY), today: TODAY });
    expect(recap?.categories.slice(0, 3).map((entry) => [entry.category, entry.seconds / 60])).toEqual([
      ["entertainment", 101], ["utility", 48], ["communication", 40],
    ]);
  });

  it("says a page title the way a person would, without its unread count or the site's name", () => {
    const site = (domain: string) => firstDaySourceOf({ appName: "Google Chrome", bundleId: null, siteDomain: domain });
    expect(storyTitle("(3) Street food tour - YouTube", site("youtube.com"))).toBe("Street food tour");
    expect(storyTitle("Lo-fi mix | dingo - YouTube", site("youtube.com"))).toBe("Lo-fi mix | dingo");
    expect(storyTitle("Home / X", site("x.com"))).toBe("Home");
    expect(storyTitle("Pull requests · edgethink00/drifty", site("github.com"))).toBe("Pull requests · edgethink00/drifty");
  });

  it("names the longest focus stretch by the page title that held most of it", () => {
    const recap = buildFirstDayRecap({
      segments: visits([
        [9, 0, 30 * 60, "chatgpt.com", "Draft a reply to the review - ChatGPT", "workspace", "focus"],
        [9, 30, 10 * 60, "chatgpt.com", "(2) Rename the release notes - ChatGPT", "workspace", "focus"],
        [9, 40, 20 * 60, "youtube.com", "Street food tour - YouTube", "entertainment", "drift"],
        // A title that only names its site says no more than the site: no title for that stretch.
        [13, 0, 50 * 60, "notion.so", "Notion", "workspace", "focus"],
      ]),
      day: DAY,
      today: TODAY,
    });
    expect(recap?.longestFocus).toMatchObject({ seconds: 50 * 60, source: { label: "notion.so" } });
    expect(recap?.longestFocus?.title).toBeUndefined();
    const morning = buildFirstDayRecap({
      segments: visits([
        [9, 0, 30 * 60, "chatgpt.com", "Draft a reply to the review - ChatGPT", "workspace", "focus"],
        [9, 30, 10 * 60, "chatgpt.com", "(2) Rename the release notes - ChatGPT", "workspace", "focus"],
        [9, 40, 20 * 60, "youtube.com", "Street food tour - YouTube", "entertainment", "drift"],
      ]),
      day: DAY,
      today: TODAY,
    });
    expect(morning?.longestFocus).toMatchObject({ seconds: 40 * 60, title: "Draft a reply to the review" });
  });

  it("tells a day from 20 minutes classified, and keeps the sample cards below that whatever its focus", () => {
    const day = (minutes: number) => visits([[9, 0, minutes * 60, "docs.google.com", "Release notes", "workspace", "focus"]]);
    // A day of under an hour draws four hours, not eight, so its visits are not lost among empty hours.
    expect(resolveFirstDayRecap({ segments: day(20), day: DAY, today: TODAY })).toMatchObject({ decisionReason: "story_low_focus", recap: { classifiedSeconds: 20 * 60, hourCount: 4 } });
    expect(resolveFirstDayRecap({ segments: day(19), day: DAY, today: TODAY }).decisionReason).toBe("below_classified_minimum");
  });

  it("tells the three recent days together when no day holds a story on its own", () => {
    const review = buildIntroReviewCase("thinDays", (offset) => shiftIsoDate(TODAY, offset));
    const yesterday = review.segments.filter((segment) => segment.startedAt.slice(0, 10) === DAY || segment.id.includes("thin-1-"));
    // Yesterday alone holds 18 minutes: no story.
    expect(resolveFirstDayStory({ segments: yesterday, day: DAY, today: TODAY }).decisionReason).toBe("below_classified_minimum");
    const story = resolveFirstDayStory({ segments: yesterday, recentSegments: review.segments, day: DAY, today: TODAY });
    expect(story.decisionReason).toBe("story_low_focus");
    expect(story.recap).toMatchObject({
      dayRelation: "recentDays",
      day: TODAY,
      days: ["2026-09-29", DAY, TODAY],
      classifiedSeconds: 46 * 60,
      focusSeconds: 21 * 60,
      hourCount: 3,
      longestFocus: { seconds: 8 * 60, source: { label: "github.com" }, title: "drifty / onboarding", from: { hourIndex: 2 } },
    });
    // One column a day, its blocks placed by minutes into the day: 17, 18 and 11 minutes.
    expect(story.recap?.columnMinutes).toBe(24 * 60);
    const minutesOfDay = [0, 1, 2].map((column) => story.recap?.blocks.filter((block) => block[0] === column).reduce((total, block) => total + block[2] - block[1], 0));
    expect(minutesOfDay).toEqual([17, 18, 11]);
    // Today's github.com visit, 10:00 to 10:08.
    expect(story.recap?.blocks.filter((block) => block[0] === 2).map((block) => [block[1], block[2]])).toContainEqual([10 * 60, 10 * 60 + 8]);
    // A segment read for two days is counted once.
    expect(resolveFirstDayStory({ segments: yesterday, recentSegments: [...review.segments, ...review.segments], day: DAY, today: TODAY }).recap?.classifiedSeconds).toBe(46 * 60);
    // Too little even together: the day keeps its own reason.
    const twoVisits = review.segments.slice(0, 2);
    expect(resolveFirstDayStory({ segments: yesterday, recentSegments: twoVisits, day: DAY, today: TODAY }).decisionReason).toBe("below_classified_minimum");
  });

  it("returns no recap while too little of the day is classified", () => {
    const fewClassified = buildFirstDayReviewSegments(DAY, 1);
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
describe("first-day story readiness at the preparation time limit", () => {
  it("decides as the intro does: the day alone, then the three recent days, read only when needed", async () => {
    const readRecentDays = vi.fn(async () => [] as ActivitySegment[]);
    expect(await firstDayStoryReadyNow({ day: DAY, today: TODAY, readDay: async () => buildFirstDayReviewSegments(DAY), readRecentDays })).toBe(true);
    expect(readRecentDays).not.toHaveBeenCalled();

    // Yesterday alone holds 18 minutes; the three days together hold 46.
    const thin = buildIntroReviewCase("thinDays", (offset) => shiftIsoDate(TODAY, offset));
    const yesterday = thin.segments.filter((segment) => segment.startedAt.slice(0, 10) === DAY || segment.id.includes("thin-1-"));
    expect(await firstDayStoryReadyNow({ day: DAY, today: TODAY, readDay: async () => yesterday, readRecentDays: async () => thin.segments })).toBe(true);
    expect(await firstDayStoryReadyNow({ day: DAY, today: TODAY, readDay: async () => yesterday, readRecentDays: async () => yesterday })).toBe(false);
  });

  it("is not ready on a long day that is still mostly unsorted", async () => {
    // Seven hours recorded, one 14-minute visit sorted so far: the intro would show the sample cards.
    const unsorted = buildFirstDayReviewSegments(DAY, 1);
    expect(await firstDayStoryReadyNow({ day: DAY, today: TODAY, readDay: async () => unsorted, readRecentDays: async () => unsorted })).toBe(false);
  });
});
