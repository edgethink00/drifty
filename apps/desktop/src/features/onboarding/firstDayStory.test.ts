import { describe, expect, it } from "vitest";
import { buildFirstDayRecap } from "./firstDayStory";
import { buildFirstDayReviewSegments, buildIntroReviewCase } from "./introStoryReview";

const DAY = "2026-09-30";
const TODAY = "2026-10-01";

describe("tutorial story", () => {
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

  it("tells yesterday only; a prepared today or earlier day keeps the sample cards", () => {
    expect(buildFirstDayRecap({ segments: buildFirstDayReviewSegments(TODAY), day: TODAY, today: TODAY })).toBeNull();
    expect(buildFirstDayRecap({ segments: buildFirstDayReviewSegments("2026-09-29"), day: "2026-09-29", today: TODAY })).toBeNull();
  });

  it("needs 30 minutes of focus to open the story on focus", () => {
    const segments = buildFirstDayReviewSegments(DAY).map((segment) => segment.classification?.productivity === "focus" && segment.siteDomain !== "docs.google.com"
      ? { ...segment, classification: { ...segment.classification, productivity: "neutral" as const } } : segment);
    // Only docs.google.com stays focus: 22 + 28 = 50 minutes, enough.
    expect(buildFirstDayRecap({ segments, day: DAY, today: TODAY })?.focusSeconds).toBe(50 * 60);
    const thin = segments.map((segment) => segment.siteTitle === "Launch checklist"
      ? { ...segment, classification: { ...segment.classification!, productivity: "neutral" as const } } : segment);
    // 22 minutes of focus is not enough to lead with.
    expect(buildFirstDayRecap({ segments: thin, day: DAY, today: TODAY })).toBeNull();
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
