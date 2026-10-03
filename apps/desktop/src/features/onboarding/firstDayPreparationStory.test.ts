import { describe, expect, it } from "vitest";
import { buildFirstDayChart, buildFirstDayDiscoveries } from "./firstDayPreparationStory";
import { buildFirstDayReviewSegments } from "./firstDayPreparationReviewData";

const DAY = "2026-09-30";

describe("first-day preparation facts", () => {
  it("groups the stacked sources by site and marks unclassified ones pending", () => {
    const pending = buildFirstDayDiscoveries(buildFirstDayReviewSegments(DAY, 0));
    expect(pending.items.every((item) => item.verdict === "pending")).toBe(true);
    expect(pending.siteCount).toBe(13);
    expect(pending.items[0]).toMatchObject({ label: "github.com", kind: "site" });
    const done = buildFirstDayDiscoveries(buildFirstDayReviewSegments(DAY));
    expect(done.items.find((item) => item.label === "youtube.com")?.verdict).toBe("drift");
    expect(done.classifiedSeconds).toBe(done.totalSeconds);
  });

  it("draws the loaded day before classification and finds its longest focus stretch once it lands", () => {
    const pending = buildFirstDayChart(buildFirstDayReviewSegments(DAY, 0));
    expect(pending?.blocks.length).toBeGreaterThan(0);
    expect(pending?.blocks.every((block) => block[3] === "pending")).toBe(true);
    expect(pending?.longestFocus).toBeNull();
    const classified = buildFirstDayChart(buildFirstDayReviewSegments(DAY));
    expect(classified).toMatchObject({ firstHour: 9, hourCount: 13, longestFocus: { seconds: 64 * 60, source: { label: "github.com" } } });
    expect(buildFirstDayChart([])).toBeNull();
  });
});
