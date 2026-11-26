import { describe, expect, it } from "vitest";
import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";
import { buildFirstDayRecap, refineIntroDecisionReason, resolveFirstDayRecap, storyTitle } from "./firstDayStory";
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

  it("opens on focus from 30 minutes, on the time it read from 5, and on its time by kind below that", () => {
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
    // 4 minutes of focus has no stretch worth naming: the story opens on the day's time by kind.
    const traceStory = resolveFirstDayRecap({ segments: trace, day: DAY, today: TODAY });
    expect(traceStory.decisionReason).toBe("story_no_focus");
    expect(traceStory.recap).toMatchObject({ lead: "kinds", focusSeconds: 4 * 60 });
    expect(traceStory.recap?.categories.slice(0, 3).map((entry) => [entry.category, entry.seconds / 60])).toEqual([
      ["workspace", 259], ["entertainment", 86], ["communication", 39],
    ]);
  });

  it("sorts a day off by kind, and reads one site two ways by its page titles", () => {
    const recap = buildFirstDayRecap({ ...buildIntroReviewCase("noFocus", () => DAY), today: TODAY });
    expect(recap?.categories.slice(0, 3).map((entry) => [entry.category, entry.seconds / 60])).toEqual([
      ["entertainment", 101], ["utility", 48], ["communication", 40],
    ]);
    // Netflix (40 min) is longer than Street food tour (35 min) but its title is only the site's name, and
    // the mail inbox is never shown by its title.
    expect(recap?.examples.map((example) => [example.title, example.category])).toEqual([
      ["Jeju trip plan", "utility"], ["Street food tour", "entertainment"], ["Morning jazz playlist", "music"],
    ]);
    expect(recap?.readingSite?.source.label).toBe("youtube.com");
    expect(recap?.readingSite?.kinds.map((kind) => [kind.category, kind.seconds / 60, kind.pageCount, kind.page?.title])).toEqual([
      ["entertainment", 61, 2, "Street food tour"], ["music", 24, 1, "Morning jazz playlist"],
    ]);
  });

  it("says a page title the way a person would, without its unread count or the site's name", () => {
    const site = (domain: string) => firstDaySourceOf({ appName: "Google Chrome", bundleId: null, siteDomain: domain });
    expect(storyTitle("(3) Street food tour - YouTube", site("youtube.com"))).toBe("Street food tour");
    expect(storyTitle("Lo-fi mix | dingo - YouTube", site("youtube.com"))).toBe("Lo-fi mix | dingo");
    expect(storyTitle("Home / X", site("x.com"))).toBe("Home");
    expect(storyTitle("Pull requests · edgethink00/drifty", site("github.com"))).toBe("Pull requests · edgethink00/drifty");
  });

  it("reads a site by its pages only when each kind has a steady page held longer than a glance", () => {
    const recap = buildFirstDayRecap({
      segments: visits([
        // Two focus kinds on one site: read two ways, but the verdict never changes.
        [9, 0, 60 * 60, "docs.google.com", "Budget sheet", "workspace", "focus"],
        [10, 0, 50 * 60, "docs.google.com", "Course notes", "learning", "focus"],
        [11, 0, 30 * 60, "youtube.com", "Funny cats compilation - YouTube", "entertainment", "drift"],
        [11, 30, 25 * 60, "youtube.com", "(2) Lo-fi beats to study - YouTube", "music", "neutral"],
        // A title Drifty sorted two ways is an unsteady label, and ten seconds is a passing tab.
        [12, 0, 10 * 60, "youtube.com", "Mixed video - YouTube", "entertainment", "drift"],
        [12, 10, 10 * 60, "youtube.com", "Mixed video - YouTube", "music", "neutral"],
        [12, 20, 10, "youtube.com", "Rust ownership explained - YouTube", "workspace", "focus"],
      ]),
      day: DAY,
      today: TODAY,
    });
    // YouTube's pages differ in verdict (drift and neutral), so it is told before the larger Google Docs.
    expect(recap?.readingSite?.source.label).toBe("youtube.com");
    expect(recap?.readingSite?.pageCount).toBe(4);
    expect(recap?.readingSite?.kinds.map((kind) => [kind.category, kind.pageCount, kind.page?.title ?? null])).toEqual([
      ["entertainment", 2, "Funny cats compilation"], ["music", 2, "Lo-fi beats to study"], ["workspace", 1, null],
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
