import { describe, expect, it } from "vitest";
import { buildFirstDayChart, buildFirstDayDiscoveries, buildFirstDayReadingSources, firstDayVerdictSplit } from "./firstDayPreparationStory";
import { buildFirstDayReviewSegments, FIRST_DAY_REVIEW_BATCHES, firstDayReviewSegmentId } from "./firstDayPreparationReviewData";

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

  it("keeps a source's split when context sorted it two ways", () => {
    const done = buildFirstDayDiscoveries(buildFirstDayReviewSegments(DAY));
    const youtube = done.items.find((item) => item.label === "youtube.com");
    const github = done.items.find((item) => item.label === "github.com");
    expect(youtube && firstDayVerdictSplit(youtube)).toEqual([
      { verdict: "drift", seconds: 56 * 60 },
      { verdict: "focus", seconds: 16 * 60 },
    ]);
    expect(github && firstDayVerdictSplit(github)).toBeNull();
  });

  it("names a batch's sources by the time spent in them across the day", () => {
    const segments = buildFirstDayReviewSegments(DAY, 0);
    const reading = buildFirstDayReadingSources(segments, FIRST_DAY_REVIEW_BATCHES[1].map(firstDayReviewSegmentId));
    expect(reading.map((source) => source.label)).toEqual(["youtube.com", "netflix.com", "x.com"]);
    expect(buildFirstDayReadingSources(segments, [])).toEqual([]);
    expect(buildFirstDayReadingSources(segments, ["not-on-this-day"])).toEqual([]);
  });
});
